-- Migration 038: Luyện từ vựng (clone luyentu, trừ Listening/Đặc biệt).
-- Nguồn: tool-crawl/crawl-luyentu/themes-12.json (11 themes unique, 361 sets).
-- Words sẽ được import sau khi có JWT fresh (15 phút) qua scripts/import-vocab.js

CREATE TABLE IF NOT EXISTS vocab_themes (
  slug VARCHAR(128) PRIMARY KEY,
  luyentu_id UUID,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  difficulty SMALLINT NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
  total_sets INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vocab_sets (
  id UUID PRIMARY KEY,
  theme_slug VARCHAR(128) NOT NULL REFERENCES vocab_themes(slug) ON DELETE CASCADE,
  name TEXT NOT NULL,
  order_idx INTEGER NOT NULL DEFAULT 0,
  vocab_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vocab_words (
  id UUID PRIMARY KEY,
  set_id UUID NOT NULL REFERENCES vocab_sets(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  pronunciation TEXT NOT NULL DEFAULT '',
  pos VARCHAR(32) NOT NULL DEFAULT '',
  meaning_vi TEXT NOT NULL DEFAULT '',
  example TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  audio_url TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tiến độ học từng user (Chưa thuộc / Đã thuộc), phục vụ khối Tùy chỉnh
CREATE TABLE IF NOT EXISTS vocab_progress (
  mssv VARCHAR(32) NOT NULL,
  word_id UUID NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'learning' CHECK (status IN ('learning','known','review')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mssv, word_id)
);

CREATE INDEX IF NOT EXISTS vocab_sets_theme_idx ON vocab_sets (theme_slug, order_idx);
CREATE INDEX IF NOT EXISTS vocab_words_set_idx ON vocab_words (set_id, sort_order);
CREATE INDEX IF NOT EXISTS vocab_words_term_idx ON vocab_words USING gin (to_tsvector('simple', term));
CREATE INDEX IF NOT EXISTS vocab_progress_mssv_idx ON vocab_progress (mssv, updated_at DESC);
