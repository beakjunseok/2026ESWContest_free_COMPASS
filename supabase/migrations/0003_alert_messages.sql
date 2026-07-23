-- 경비실이 직접 작성/선택한 경고 메시지를 음성으로 재생하기 위한 컬럼과 저장소.
--
-- message   : 경비실이 입력/선택한 원문 텍스트 (없으면 자동 감지 경보 = 기본 경고음만 재생)
-- audio_url : message를 TTS로 변환해 Supabase Storage에 올린 mp3의 공개 URL

alter table alerts
  add column if not exists message text,
  add column if not exists audio_url text;

insert into storage.buckets (id, name, public)
values ('alert-audio', 'alert-audio', true)
on conflict (id) do nothing;

drop policy if exists "alert_audio_public_read" on storage.objects;
create policy "alert_audio_public_read"
  on storage.objects for select
  using (bucket_id = 'alert-audio');
