ALTER TABLE threads DROP CONSTRAINT IF EXISTS threads_body_check;
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_body_check;
INSERT INTO categories (id, slug, name, description, icon, color, sort_order) VALUES
  (6, 'general', '総合', 'すべてのジャンルの話題が集まる場所', '◎', '#d35400', 0)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  color = EXCLUDED.color,
  sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) > 0),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_pair
  ON direct_messages (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_messages_unread
  ON direct_messages (recipient_id, created_at DESC) WHERE read_at IS NULL;

UPDATE users SET role = 'admin', updated_at = NOW()
WHERE id = (
  SELECT id FROM users WHERE status = 'active' ORDER BY created_at, id LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND status = 'active');

SELECT setval(pg_get_serial_sequence('categories', 'id'), GREATEST((SELECT max(id) FROM categories), 1));
