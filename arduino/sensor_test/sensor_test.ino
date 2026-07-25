/*
  sensor_test.ino
  소리센서(A2) / 진동센서(A1) 배선 확인용 테스트 스케치.

  사용법:
    1) 이 스케치를 업로드
    2) 시리얼 모니터를 열고 보드레이트를 115200으로 설정
    3) 소리센서 쪽에서 손뼉을 치거나 말을 해보고, 진동센서 쪽은 책상을 두드리거나
       살짝 흔들어보면서 값이 반응해서 변하는지 확인

  값이 거의 안 움직이면: 배선(VCC/GND/신호선), 센서 감도 조절 나사(있는 경우), 핀 번호를
  다시 확인하세요.

  주의: WiFi를 쓰는 실제 노드(noise_node.ino)에서는 ADC2 핀(A1/A2가 보드에 따라 여기 해당될
  수 있음)이 WiFi 동작 중 불안정해질 수 있어 GPIO32~35(ADC1)를 사용합니다. 지금은 배선
  확인용이라 문제 없지만, WiFi 붙이는 단계에서 값이 이상해지면 ADC1 핀으로 옮겨보세요.
*/

const int PIN_SOUND     = A2;
const int PIN_VIBRATION = A1;

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("소리센서(A2) / 진동센서(A1) 테스트 시작");
}

void loop() {
  int soundValue = analogRead(PIN_SOUND);
  int vibrationValue = analogRead(PIN_VIBRATION);

  Serial.print("소리(A2): ");
  Serial.print(soundValue);
  Serial.print("\t진동(A1): ");
  Serial.println(vibrationValue);

  delay(100);
}
