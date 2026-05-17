import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { PageHeader } from '../PageHeader.js';

describe('PageHeader', () => {
  it('exposes a single accessible page heading', () => {
    render(<PageHeader title="Tasks" description="Current work" actions={<button>New</button>} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toBeTruthy();
    expect(screen.getByText('Current work')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New' })).toBeTruthy();
  });
});
