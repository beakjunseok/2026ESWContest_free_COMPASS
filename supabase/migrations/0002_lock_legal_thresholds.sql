-- 층간소음 기준을 법정 기준값으로 고정하고 층별/사용자 조정을 불가능하게 한다.
--
-- 출처: 국가법령정보 생활법령(https://easylaw.go.kr, "층간소음의 기준")
--   직접충격 소음: 1분 등가소음도(Leq)  주간 39dB / 야간 34dB
--                 최고소음도(Lmax)    주간 57dB / 야간 52dB
--   공기전달 소음: 5분 등가소음도(Leq)  주간 45dB / 야간 40dB
--
-- 이 프로젝트의 센서 값은 300ms 구간 피크를 2초마다 전송하는 방식으로, 1분/5분
-- 등가소음도(장시간 평균)를 실제로 계산하지 않는다. 따라서 순간 최고값 개념인
-- "최고소음도(Lmax)"가 우리 측정 방식과 더 부합하므로, 충격소음 판정에는 Lmax
-- (57/52)를 사용한다. 공기전달 소음은 법령에 Lmax 규정이 없어 유일하게 명시된
-- 5분 등가소음도(45/40)를 그대로 사용한다. README 참고.
--
-- 위 수치는 법령상 고정값이며 더 이상 층별로 다르게 설정하거나 대시보드에서
-- 변경할 수 없다.

alter table floors
  drop column if exists day_impact_limit_db,
  drop column if exists night_impact_limit_db,
  drop column if exists day_airborne_limit_db,
  drop column if exists night_airborne_limit_db;

drop policy if exists "floors_update_all" on floors;

create or replace function fn_process_sensor_reading()
returns trigger
security definer
set search_path = public
as $$
declare
  is_day boolean;
  impact_limit constant numeric := 57; -- 최고소음도 주간, 아래에서 야간이면 52로 대체
  impact_limit_night constant numeric := 52;
  airborne_limit constant numeric := 45; -- 5분 등가소음도 주간, 야간이면 40으로 대체
  airborne_limit_night constant numeric := 40;
  effective_impact_limit numeric;
  effective_airborne_limit numeric;
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
  if not exists (select 1 from floors where id = new.floor_id) then
    return new;
  end if;

  is_day := extract(hour from (new.created_at at time zone 'Asia/Seoul')) >= 6
        and extract(hour from (new.created_at at time zone 'Asia/Seoul')) < 22;

  effective_impact_limit := case when is_day then impact_limit else impact_limit_night end;
  effective_airborne_limit := case when is_day then airborne_limit else airborne_limit_night end;

  if new.floor_vibration >= effective_impact_limit then
    ntype := 'impact';
    dir := 'own_impact';
    mdb := new.floor_vibration;
    lim := effective_impact_limit;

    select * into below_ceiling
      from sensor_readings
      where floor_id = new.floor_id - 1
        and created_at between new.created_at - interval '2 seconds'
                            and new.created_at + interval '2 seconds'
      order by created_at desc
      limit 1;

    if found and below_ceiling.ceiling_vibration >= effective_impact_limit * 0.5 then
      conf := 'high';
    else
      conf := 'medium';
    end if;

    exceeded := true;
  elsif new.floor_sound_db >= effective_airborne_limit then
    ntype := 'airborne';
    dir := 'own_airborne';
    mdb := new.floor_sound_db;
    lim := effective_airborne_limit;
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
