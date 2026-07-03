import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SettingsDirtyProvider, SettingsNav } from '../SettingsNav.js';
import { SettingsSection } from '../SettingsSection.js';

afterEach(cleanup);

const ENTRIES = [
  { id: 'section-a', label: 'Alpha' },
  { id: 'section-b', label: 'Beta' },
];

describe('SettingsNav', () => {
  it('renders one anchor per entry', () => {
    const { getByText, getByTestId } = render(<SettingsNav entries={ENTRIES} />);
    expect(getByTestId('settings-nav')).toBeTruthy();
    expect(getByText('Alpha').closest('a')?.getAttribute('href')).toBe('#section-a');
    expect(getByText('Beta').closest('a')?.getAttribute('href')).toBe('#section-b');
  });

  it('shows an unsaved dot for sections that report dirty', () => {
    const { queryByLabelText, rerender } = render(
      <SettingsDirtyProvider>
        <SettingsNav entries={ENTRIES} />
        <SettingsSection title="Alpha" testId="section-a" dirty>
          <div />
        </SettingsSection>
        <SettingsSection title="Beta" testId="section-b" dirty={false}>
          <div />
        </SettingsSection>
      </SettingsDirtyProvider>,
    );
    expect(queryByLabelText('Alpha: unsaved changes')).toBeTruthy();
    expect(queryByLabelText('Beta: unsaved changes')).toBeNull();

    // Saving Alpha clears the dot.
    rerender(
      <SettingsDirtyProvider>
        <SettingsNav entries={ENTRIES} />
        <SettingsSection title="Alpha" testId="section-a" dirty={false}>
          <div />
        </SettingsSection>
        <SettingsSection title="Beta" testId="section-b" dirty={false}>
          <div />
        </SettingsSection>
      </SettingsDirtyProvider>,
    );
    expect(queryByLabelText('Alpha: unsaved changes')).toBeNull();
  });

  it('SettingsSection exposes its testId as DOM id (anchor target)', () => {
    const { container } = render(
      <SettingsSection title="Alpha" testId="section-a">
        <div />
      </SettingsSection>,
    );
    expect(container.querySelector('section#section-a')).toBeTruthy();
  });
});
