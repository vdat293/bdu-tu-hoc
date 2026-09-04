-- Migration 023: Bổ sung 7 danh hiệu mới:
-- GPA tích lũy: #Học thần (>= 3.6), #Tinh hoa BDU (>= 3.2)
-- Thành tựu: #Bất bại môn phái, #Con nhà người ta, #Thợ săn tín chỉ, #Cú đêm luyện thi, #Tay to gánh team

INSERT INTO identity_items (
  id, item_type, label, description, rarity, asset_key, display_policy, sort_order, metadata
) VALUES
  (
    'title:hoc-than', 'title', '#Học thần', 'GPA tích lũy từ 3.60 trở lên (Xuất sắc)',
    'legendary', 'hoc-than', 'optional', 12,
    '{"manual_grantable": true, "source": "config", "tone": "gold", "auto_rule": "cumulative_gpa_3_6"}'::jsonb
  ),
  (
    'title:tinh-hoa-bdu', 'title', '#Tinh hoa BDU', 'GPA tích lũy từ 3.20 trở lên (Giỏi)',
    'epic', 'tinh-hoa-bdu', 'optional', 13,
    '{"manual_grantable": true, "source": "config", "tone": "emerald", "auto_rule": "cumulative_gpa_3_2"}'::jsonb
  ),
  (
    'title:bat-bai-mon-phai', 'title', '#Bất bại môn phái', 'Tích lũy từ 50 tín chỉ trở lên và chưa từng rớt môn',
    'epic', 'bat-bai-mon-phai', 'optional', 14,
    '{"manual_grantable": true, "source": "config", "tone": "gold", "auto_rule": "credits_50_no_fail"}'::jsonb
  ),
  (
    'title:con-nha-nguoi-ta', 'title', '#Con nhà người ta', 'Đạt GPA tuyệt đối 4.00 trong một học kỳ',
    'legendary', 'con-nha-nguoi-ta', 'optional', 15,
    '{"manual_grantable": true, "source": "config", "tone": "violet", "auto_rule": "perfect_semester"}'::jsonb
  ),
  (
    'title:tho-san-tin-chi', 'title', '#Thợ săn tín chỉ', 'Tích lũy từ 80 tín chỉ trở lên toàn khóa',
    'epic', 'tho-san-tin-chi', 'optional', 16,
    '{"manual_grantable": true, "source": "config", "tone": "blue", "auto_rule": "cumulative_credits_80"}'::jsonb
  ),
  (
    'title:cu-dem-luyen-thi', 'title', '#Cú đêm luyện thi', 'Hoàn thành từ 18 tín chỉ một kỳ với GPA từ 3.00',
    'rare', 'cu-dem-luyen-thi', 'optional', 17,
    '{"manual_grantable": true, "source": "config", "tone": "violet", "auto_rule": "heavy_semester"}'::jsonb
  ),
  (
    'title:tay-to-ganh-team', 'title', '#Tay to gánh team', 'Thành viên tích cực gánh team và chia sẻ tài liệu',
    'rare', 'tay-to-ganh-team', 'optional', 18,
    '{"manual_grantable": true, "source": "config", "tone": "blue", "auto_rule": "community_contributor"}'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  rarity = EXCLUDED.rarity,
  asset_key = EXCLUDED.asset_key,
  display_policy = EXCLUDED.display_policy,
  sort_order = EXCLUDED.sort_order,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();
