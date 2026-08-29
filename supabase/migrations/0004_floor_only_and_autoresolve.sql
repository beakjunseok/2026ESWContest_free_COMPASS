-- 노드 구조 변경(천장 센서 제거)에 맞춰 스키마와 판정 트리거를 정리한다.
--
-- 배경
--   노드가 "층마다 1대 / 천장+바닥 4센서" 에서 "1대가 3개 층의 바닥 센서만 읽음" 으로
--   바뀌었다. 새 펌웨어는 floor_sound_db / floor_vibration 만 보내는데,
--   sensor_readings.ceiling_* 이 not null 이라 그대로 두면 INSERT 자체가 실패한다.
--
-- 이 마이그레이션이 하는 일
--   1) ceiling_* 컬럼 제거
--   2) 하나의 소음 "에피소드" 당 이벤트/경고를 1건만 만들고, 30초간 조용하면 자동 종료
--   3) 신뢰도(confidence) 를 천장 센서 대조 대신 지속 횟수로 판정

-- ---------------------------------------------------------------------------
-- 1) 천장 센서 컬럼 제거
-- ---------------------------------------------------------------------------
alter table sensor_readings
  drop column if exists ceiling_sound_db,
  drop column if exists ceiling_vibration;

comment on table sensor_readings is
  '노드가 올리는 바닥 센서 원시 측정값. floor_sound_db 는 소리센서, floor_vibration 은 '
  '진동센서를 같은 dB 스케일로 환산한 값이며, 소리·진동이 없을 때의 하한은 0 이 아니라 30 이다.';

-- ---------------------------------------------------------------------------
-- 2) 이벤트 진행 상태 추적 컬럼
-- ---------------------------------------------------------------------------
alter table noise_events
  add column if not exists last_exceeded_at timestamptz,
  add column if not exists exceed_count integer not null default 1;

update noise_events
   set last_exceeded_at = created_at
 where last_exceeded_at is null;

alter table noise_events
  alter column last_exceeded_at set default now(),
  alter column last_exceeded_at set not null;

comment on column noise_events.last_exceeded_at is '기준을 초과한 마지막 측정 시각';
comment on column noise_events.exceed_count is '이 이벤트 동안 기준을 초과한 측정 횟수';

-- 진행 중(미해결) 이벤트를 층별로 빠르게 찾기 위한 부분 인덱스
create index if not exists idx_noise_events_open
  on noise_events (floor_id)
  where resolved_at is null;

-- ---------------------------------------------------------------------------
-- 3) 판정 트리거 재작성
--
-- 판정 기준 (0002 의 법정 고정값 유지)
--   충격소음  floor_vibration  >= 57(주간) / 52(야간)   ← 최고소음도 Lmax
--   공기전달  floor_sound_db   >= 45(주간) / 40(야간)   ← 5분 등가소음도
--
-- 에피소드 처리
--   - 미해결 이벤트가 없을 때 기준을 넘으면: 이벤트 1건 + 경고 1건 생성
--   - 미해결 이벤트가 있는 동안 계속 넘으면: 새로 만들지 않고 최고값/횟수만 갱신
--     (이전에는 15초마다 새 경고가 쌓여 경비실 목록이 무한히 늘어났다)
--   - 기준 아래로 내려가고 QUIET_SECONDS 동안 재초과가 없으면: 이벤트 자동 종료
--
-- 경고(alerts) 는 자동으로 닫지 않는다. 소음이 멎었더라도 "그 시간에 이런 소음이 있었다"는
-- 사실은 경비실이 직접 확인 처리해야 기록으로 남기 때문이다.
-- ---------------------------------------------------------------------------

create or replace function fn_process_sensor_reading()
returns trigger
security definer
set search_path = public
as $$
declare
  -- 이 시간만큼 기준 초과가 없으면 소음이 끝난 것으로 본다.
  quiet_seconds constant integer := 30;
  -- 이 횟수 이상 연속으로 기준을 넘기면 일시적 튐이 아니라고 보고 신뢰도를 올린다.
  high_confidence_count constant integer := 3;

  is_day boolean;
  impact_limit numeric;
  airborne_limit numeric;

  exceeded boolean := false;
  ntype text;
  ndir text;
  mdb numeric;
  lim numeric;

  open_event noise_events%rowtype;
  has_open_event boolean;
  inserted_event_id bigint;
begin
  if not exists (select 1 from floors where id = new.floor_id) then
    return new;
  end if;

  is_day := extract(hour from (new.created_at at time zone 'Asia/Seoul')) >= 6
        and extract(hour from (new.created_at at time zone 'Asia/Seoul')) < 22;

  impact_limit   := case when is_day then 57 else 52 end;
  airborne_limit := case when is_day then 45 else 40 end;

  -- 충격소음(진동)을 먼저 본다. 같은 순간에 둘 다 넘으면 충격소음이 더 무겁게 다뤄진다.
  if new.floor_vibration >= impact_limit then
    ntype := 'impact';
    ndir  := 'own_impact';
    mdb   := new.floor_vibration;
    lim   := impact_limit;
    exceeded := true;
  elsif new.floor_sound_db >= airborne_limit then
    ntype := 'airborne';
    ndir  := 'own_airborne';
    mdb   := new.floor_sound_db;
    lim   := airborne_limit;
    exceeded := true;
  end if;

  select * into open_event
    from noise_events
    where floor_id = new.floor_id
      and resolved_at is null
    order by created_at desc
    limit 1;
  has_open_event := found;

  if exceeded then
    if has_open_event then
      -- 같은 소음이 이어지는 중: 새 경고를 만들지 않고 진행 중인 이벤트만 갱신
      update noise_events
         set last_exceeded_at = new.created_at,
             exceed_count     = exceed_count + 1,
             -- 공기전달로 시작했다가 충격이 잡히면 충격소음으로 승격시키고 기준도 바꾼다
             noise_type  = case when ntype = 'impact' then 'impact' else noise_type end,
             direction   = case when ntype = 'impact' then 'own_impact' else direction end,
             limit_db    = case when ntype = 'impact' then lim else limit_db end,
             measured_db = case
                             when ntype = 'impact' and noise_type = 'airborne' then mdb
                             else greatest(measured_db, mdb)
                           end,
             confidence  = case
                             when exceed_count + 1 >= high_confidence_count then 'high'
                             else confidence
                           end
       where id = open_event.id;
    else
      insert into noise_events (floor_id, noise_type, direction, measured_db, limit_db,
                                confidence, is_day, last_exceeded_at, exceed_count)
        values (new.floor_id, ntype, ndir, mdb, lim,
                'medium', is_day, new.created_at, 1)
        returning id into inserted_event_id;

      insert into alerts (floor_id, event_id, status, triggered_by)
        values (new.floor_id, inserted_event_id, 'pending', 'system');
    end if;

  elsif has_open_event
    and new.created_at - open_event.last_exceeded_at >= make_interval(secs => quiet_seconds)
  then
    -- 조용해진 지 충분히 지났다: 소음 종료
    update noise_events
       set resolved_at = new.created_at
     where id = open_event.id;
  end if;

  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 4) 기존 데이터 정리
--    구 펌웨어가 원시 ADC 값(1900 등)을 dB 컬럼에 그대로 올려 만들어진 이벤트/경고를
--    닫는다. dB 스케일 상 나올 수 없는 값(120dB 초과)만 대상으로 한다.
-- ---------------------------------------------------------------------------
update alerts a
   set status = 'cancelled'
  from noise_events e
 where a.event_id = e.id
   and a.status in ('pending', 'delivered')
   and e.measured_db > 120;

update noise_events
   set resolved_at = coalesce(resolved_at, now())
 where measured_db > 120;
