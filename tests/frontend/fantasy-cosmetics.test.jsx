import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getEquippedFrame, getFantasyFrames, setFrameCatalog, TitleBadges } from '../../client/src/components/identity/Identity.jsx';

afterEach(() => setFrameCatalog([]));

describe('fantasy cosmetics', () => {
  it('shows the same catalog frame as locked until ownership is granted', () => {
    setFrameCatalog([{ key: 'violet-1', label: 'Tử Tinh Sơ Khai', collection: 'violet', rarity: 'common', asset_url: '/assets/frames/violet-1.webp' }]);
    expect(getFantasyFrames({ keys: [] })[0].locked).toBe(true);
    expect(getFantasyFrames({ keys: ['violet-1'] })[0].locked).toBe(false);
    expect(getEquippedFrame('frame:violet-1')?.src).toBe('/assets/frames/violet-1.webp');
    expect(getEquippedFrame('frame:truong-1')?.title).toBe('Thiên Cực Đế Tinh BDU');
  });

  it('applies gemstone art only to the six new titles and leaves existing titles alone', () => {
    render(<><TitleBadges titles={[{ id: 'title:hoc-than', label: '#Học thần', tone: 'gold' }]} /><TitleBadges titles={[
      { id: 'title:ngoc-luc-bao', label: '#Ngọc Lục Bảo', tone: 'emerald', gem_asset: 'green' },
      { id: 'title:lam-tinh', label: '#Lam Tinh', tone: 'blue', gem_asset: 'blue' },
      { id: 'title:ho-phach', label: '#Hổ Phách', tone: 'bronze', gem_asset: 'orange' },
      { id: 'title:kim-quang', label: '#Kim Quang', tone: 'gold', gem_asset: 'gold' },
      { id: 'title:hong-ngoc', label: '#Hồng Ngọc', tone: 'charm', gem_asset: 'pink' }
    ]} /></>);
    expect(screen.getByText('#Học thần').closest('.identity-title-badge')).not.toHaveClass('has-title-gem');
    expect(screen.getByText('#Ngọc Lục Bảo').closest('.identity-title-badge')).toHaveClass('has-title-gem', 'gem-green');
    expect(screen.getByText('#Lam Tinh').closest('.identity-title-badge')).toHaveClass('gem-blue');
    expect(screen.getByText('#Hổ Phách').closest('.identity-title-badge')).toHaveClass('gem-orange');
    expect(screen.getByText('#Kim Quang').closest('.identity-title-badge')).toHaveClass('gem-gold');
    expect(screen.queryByText('#Hồng Ngọc')).not.toBeInTheDocument();
  });
});
