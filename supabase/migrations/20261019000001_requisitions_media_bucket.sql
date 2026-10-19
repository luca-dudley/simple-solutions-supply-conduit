-- Migration: 20261019000001_requisitions_media_bucket.sql
-- Description: Provision public storage bucket for audio voice notes and media

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'requisitions-media',
  'requisitions-media',
  true,
  52428800,
  ARRAY['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public Access to Requisitions Media'
  ) THEN
    CREATE POLICY "Public Access to Requisitions Media" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'requisitions-media');
  END IF;
END $$;
