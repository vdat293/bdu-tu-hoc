-- Migration 022: Tách biệt phong cách và độ hiếm cho các danh hiệu:
-- Giữ lại #TTCDS là 'vip' như cũ; 3 danh hiệu còn lại có phong cách riêng biệt:
-- #Phó bí thư đoàn: 'youth' (Đoàn thanh niên)
-- #ChatGPT: 'ai' (Trí tuệ nhân tạo)
-- #Nam vương: 'charm' (Quyến rũ / Nam vương)

ALTER TABLE identity_items DROP CONSTRAINT IF EXISTS identity_items_rarity_check;

ALTER TABLE identity_items
  ADD CONSTRAINT identity_items_rarity_check
  CHECK (rarity IN ('common', 'rare', 'epic', 'legendary', 'vip', 'youth', 'ai', 'charm'));

UPDATE identity_items
SET rarity = 'youth',
    metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{tone}', '"youth"'),
    updated_at = NOW()
WHERE id = 'title:pho-bi-thu-doan';

UPDATE identity_items
SET rarity = 'ai',
    metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{tone}', '"chatgpt"'),
    updated_at = NOW()
WHERE id = 'title:chatgpt';

UPDATE identity_items
SET rarity = 'charm',
    metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{tone}', '"charm"'),
    updated_at = NOW()
WHERE id = 'title:nam-vuong';
