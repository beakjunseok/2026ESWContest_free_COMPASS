-- 층간소음 감지 시스템 - 초기 스키마
-- 법정 기준(공동주택 층간소음의 범위와 기준에 관한 규칙, 환경부/국토부):
--   직접충격 소음(발걸음 등) 1분 등가소음도: 주간 39dB / 야간 34dB
--   직접충격 소음 최고소음도:               주간 57dB / 야간 52dB
--   공기전달 소음(TV/음향기기) 5분 등가소음도: 주간 45dB / 야간 40dB
-- 위 기본값을 floors 테이블 기본값으로 사용하고, 대시보드에서 층별로 조정 가능하게 한다.

create table if not exists floors (
  id integer primary key,
  label text not null,
  day_impact_limit_db numeric not null default 39,
  night_impact_limit_db numeric not null default 34,
  day_airborne_limit_db numeric not null default 45,
  night_airborne_limit_db numeric not null default 40,
  created_at timestamptz not null default now()
);

comment on table floors is '건물의 각 층(=센서 노드) 정보와 층별 소음 기준';

-- 센서 원시 데이터. 노드 한 대가 천장(ceiling)/바닥(floor) 각각 소리+진동 센서를 가진다.
-- ceiling_* : 윗집과 맞닿은 슬라브에서 측정 (윗층 소음이 가장 먼저 크게 잡힘)
-- floor_*   : 아랫집과 맞닿은 슬라브에서 측정 (이 집 자신의 충격소음이 가장 먼저 크게 잡힘)
-- *_db 값은 소리센서를 dB 환산 보정한 값, *_vibration 값은 진동센서를 동일 dB 스케일로
-- 환산(현장 캘리브레이션 필요)한 근사치다. README 참고.
create table if not exists sensor_readings (
  id bigint generated always as identity primary key,
  floor_id integer not null references floors(id) on delete cascade,
  ceiling_sound_db numeric not null,
  ceiling_vibration numeric not null,
  floor_sound_db numeric not null,
  floor_vibration numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sensor_readings_floor_time
  on sensor_readings (floor_id, created_at desc);

-- 기준 초과가 감지되어 특정 층이 "소음 발생지"로 판정된 사건
create table if not exists noise_events (
  id bigint generated always as identity primary key,
  floor_id integer not null references floors(id) on delete cascade,
  noise_type text not null check (noise_type in ('impact', 'airborne')),
  direction text not null check (direction in ('own_impact', 'own_airborne')),
  measured_db numeric not null,
  limit_db numeric not null,
  confidence text not null check (confidence in ('high', 'medium')),
  is_day boolean not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_noise_events_floor_time
  on noise_events (floor_id, created_at desc);

-- 스피커 경고. event_id가 있으면 자동 발생, 없으면(=null) 경비실 수동 발령
create table if not exists alerts (
  id bigint generated always as identity primary key,
  floor_id integer not null references floors(id) on delete cascade,
  event_id bigint references noise_events(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'acknowledged', 'cancelled')),
  triggered_by text not null default 'system' check (triggered_by in ('system', 'guard')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  acknowledged_at timestamptz
);

create index if not exists idx_alerts_floor_status
  on alerts (floor_id, status);

-- ---------------------------------------------------------------------------
-- 소음 발생 위치 판정 트리거
--
-- 원리: 같은 슬라브를 사이에 두고 위층의 "바닥 센서"와 아래층의 "천장 센서"가
-- 마주보고 있다. 충격이 위층 바닥에서 발생하면 위층 바닥 센서(근접)가 가장 크게,
-- 아래층 천장 센서(원거리, 감쇠)는 그보다 작게 감지된다. 따라서:
--   1) 자기 층 바닥 센서 값이 기준을 넘으면 "이 층 자신"이 충격소음 발생지로 1차 판정
--   2) 바로 아래층의 천장 센서 값(같은 슬라브, ±2초 이내 최신값)과 대조해 절반 이상
--      수준으로 함께 튀었으면 confidence='high', 아니면 'medium'
--   3) 자기 층 바닥 소리센서 값이 공기전달 기준을 넘으면 TV/음향기기형 소음으로 판정
-- 여러 층에서 동시에 소음이 발생해도 각 행이 floor_id로 구분되므로 독립적으로 처리된다.
-- ---------------------------------------------------------------------------

create or replace function fn_process_sensor_reading()
returns trigger
security definer
set search_path = public
as $$
declare
  f floors%rowtype;
  is_day boolean;
  impact_limit numeric;
  airborne_limit numeric;
  below_ceiling sensor_readings%rowtype;
  exceeded boolean := false;
  ntype text;
  dir text;
  mdb numeric;
  lim numeric;
  conf text;
  existing_open_event bigint;
  inserted_event_id bigint;
begin
  select * into f from floors where id = new.floor_id;
  if not found then
    return new;
  end if;

  is_day := extract(hour from (new.created_at at time zone 'Asia/Seoul')) >= 6
        and extract(hour from (new.created_at at time zone 'Asia/Seoul')) < 22;

  impact_limit := case when is_day then f.day_impact_limit_db else f.night_impact_limit_db end;
  airborne_limit := case when is_day then f.day_airborne_limit_db else f.night_airborne_limit_db end;

  if new.floor_vibration >= impact_limit then
    ntype := 'impact';
    dir := 'own_impact';
    mdb := new.floor_vibration;
    lim := impact_limit;

    select * into below_ceiling
      from sensor_readings
      where floor_id = new.floor_id - 1
        and created_at between new.created_at - interval '2 seconds'
                            and new.created_at + interval '2 seconds'
      order by created_at desc
      limit 1;

    if found and below_ceiling.ceiling_vibration >= impact_limit * 0.5 then
      conf := 'high';
    else
      conf := 'medium';
    end if;

    exceeded := true;
  elsif new.floor_sound_db >= airborne_limit then
    ntype := 'airborne';
    dir := 'own_airborne';
    mdb := new.floor_sound_db;
    lim := airborne_limit;
    conf := 'medium';
    exceeded := true;
  end if;

  if exceeded then
    select id into existing_open_event
      from noise_events
      where floor_id = new.floor_id
        and resolved_at is null
        and created_at > new.created_at - interval '15 seconds'
      order by created_at desc
      limit 1;

    if existing_open_event is null then
      insert into noise_events (floor_id, noise_type, direction, measured_db, limit_db, confidence, is_day)
        values (new.floor_id, ntype, dir, mdb, lim, conf, is_day)
        returning id into inserted_event_id;

      insert into alerts (floor_id, event_id, status, triggered_by)
        values (new.floor_id, inserted_event_id, 'pending', 'system');
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_process_sensor_reading on sensor_readings;
create trigger trg_process_sensor_reading
  after insert on sensor_readings
  for each row
  execute function fn_process_sensor_reading();

-- ---------------------------------------------------------------------------
-- RLS
-- 데모/교육용 프로젝트 기준으로 anon key에 넓은 읽기/쓰기 권한을 부여한다.
-- 실제 운영 환경에서는 디바이스별 인증(예: 층별 API 키 + edge function 검증)과
-- 더 세분화된 정책 적용을 권장한다 (README 보안 섹션 참고).
-- ---------------------------------------------------------------------------

alter table floors enable row level security;
alter table sensor_readings enable row level security;
alter table noise_events enable row level security;
alter table alerts enable row level security;

create policy "floors_select_all" on floors for select using (true);
create policy "floors_update_all" on floors for update using (true) with check (true);

create policy "sensor_readings_select_all" on sensor_readings for select using (true);
create policy "sensor_readings_insert_all" on sensor_readings for insert with check (true);

create policy "noise_events_select_all" on noise_events for select using (true);

create policy "alerts_select_all" on alerts for select using (true);
create policy "alerts_insert_all" on alerts for insert with check (true);
create policy "alerts_update_all" on alerts for update using (true) with check (true);

-- Realtime: 대시보드가 실시간 구독할 테이블
do $$
begin
  alter publication supabase_realtime add table sensor_readings;
  alter publication supabase_realtime add table noise_events;
  alter publication supabase_realtime add table alerts;
  alter publication supabase_realtime add table floors;
exception when duplicate_object then
  null;
end $$;

-- 데모 시드: 5개 층 (숫자는 필요에 따라 자유롭게 늘리거나 줄일 수 있음)
insert into floors (id, label) values
  (1, '1층'), (2, '2층'), (3, '3층'), (4, '4층'), (5, '5층')
on conflict (id) do nothing;
