import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Button } from '../Button.js';

describe('Button', () => {
  it('uses native disabled semantics while loading', () => {
    render(<Button loading>Save</Button>);

    const button = screen.getByRole('button', { name: 'Working…' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('renders requested variant without losing button role', () => {
    render(<Button variant="danger">Delete</Button>);

    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });
});
