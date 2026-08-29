-- 실제 설치 규모에 맞춰 층을 3개(1~3층)로 줄인다.
--
-- 노드 1대가 3개 층의 바닥 센서만 읽으므로 4·5층에는 센서가 없다. 남겨두면 대시보드에
-- 영원히 "수신 없음" 카드로만 뜨기 때문에 시드 데이터에서 제거한다.
--
-- floors 를 참조하는 sensor_readings / noise_events / alerts 는 모두
-- on delete cascade 이므로 해당 층에 붙은 측정값·이벤트·경고도 함께 지워진다.
-- (4·5층은 센서가 연결된 적이 없어 지워질 데이터가 없다.)
--
-- 층을 다시 늘릴 때는 아래처럼 되돌릴 수 있다:
--   insert into floors (id, label) values (4, '4층'), (5, '5층')
--     on conflict (id) do nothing;

delete from floors where id in (4, 5);
