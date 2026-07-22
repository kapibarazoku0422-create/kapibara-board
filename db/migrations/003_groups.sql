CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(60) NOT NULL CHECK (char_length(trim(name)) > 0),
  description varchar(300) NOT NULL DEFAULT '',
  visibility varchar(10) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(10) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS group_invites (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_invites_user ON group_invites (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages (group_id, created_at DESC);

ALTER TABLE threads ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES groups(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_threads_group ON threads (group_id, last_activity_at DESC) WHERE group_id IS NOT NULL;
