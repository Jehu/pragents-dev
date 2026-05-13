import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MasterDetail } from '../MasterDetail';

afterEach(cleanup);

describe('MasterDetail', () => {
  it('renders sidebar and main content', () => {
    const { getByText } = render(
      <MasterDetail sidebar={<div>Sidebar content</div>}>
        <div>Main content</div>
      </MasterDetail>,
    );
    expect(getByText('Sidebar content')).toBeTruthy();
    expect(getByText('Main content')).toBeTruthy();
  });

  it('renders aside and main elements', () => {
    const { container } = render(
      <MasterDetail sidebar={<span>S</span>}><span>M</span></MasterDetail>,
    );
    expect(container.querySelector('aside')).toBeTruthy();
    expect(container.querySelector('main')).toBeTruthy();
  });

  it('applies custom sidebarWidth', () => {
    const { container } = render(
      <MasterDetail sidebar={<span />} sidebarWidth="w-48"><span /></MasterDetail>,
    );
    const aside = container.querySelector('aside') as HTMLElement;
    expect(aside.className).toContain('w-48');
  });
});
