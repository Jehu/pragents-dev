import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { ProjectForm } from '../ProjectForm.js';

afterEach(() => {
  cleanup();
});

describe('ProjectForm', () => {
  it('renders the three core fields', () => {
    render(<ProjectForm onSubmit={() => {}} />);
    expect(screen.getByLabelText('Project ID')).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.getByLabelText('Directory')).toBeTruthy();
  });

  it('auto-derives id from name in create mode', () => {
    render(<ProjectForm onSubmit={() => {}} />);
    const name = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'My Cool Project' } });
    const id = screen.getByLabelText('Project ID') as HTMLInputElement;
    expect(id.value).toBe('my-cool-project');
  });

  it('strips leading punctuation so the auto-id stays valid kebab-case', () => {
    render(<ProjectForm onSubmit={() => {}} />);
    const name = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: '!! Strange Name --' } });
    const id = screen.getByLabelText('Project ID') as HTMLInputElement;
    // Without the leading-hyphen strip, this would render as `-strange-name-`
    // and fail ID validation, defeating the auto-suggest UX.
    expect(id.value).toBe('strange-name');
  });

  it('disables submit when directory is empty', () => {
    render(<ProjectForm onSubmit={() => {}} initialValues={{ id: 'x', name: 'X' }} />);
    const dir = screen.getByLabelText('Directory') as HTMLInputElement;
    fireEvent.change(dir, { target: { value: '' } });
    const submit = screen.getByRole('button', { name: /save/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('flags duplicate ids', () => {
    render(
      <ProjectForm
        onSubmit={() => {}}
        existingIds={['blog']}
        initialValues={{ id: 'blog', name: 'Blog', directory: '~/blog' }}
      />,
    );
    // Force the id field to be marked "touched" via a change event.
    const idField = screen.getByLabelText('Project ID') as HTMLInputElement;
    fireEvent.change(idField, { target: { value: 'blog' } });
    expect(screen.getByText(/already taken/)).toBeTruthy();
  });

  it('calls onSubmit with normalized values', () => {
    const onSubmit = vi.fn();
    render(<ProjectForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Site' },
    });
    fireEvent.change(screen.getByLabelText('Directory'), {
      target: { value: '~/site' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      id: 'site',
      name: 'Site',
      directory: '~/site',
    });
  });

  it('disables id field in edit mode', () => {
    render(
      <ProjectForm
        onSubmit={() => {}}
        editMode
        initialValues={{ id: 'frozen', name: 'F', directory: '~/f' }}
      />,
    );
    const idField = screen.getByLabelText('Project ID') as HTMLInputElement;
    expect(idField.disabled).toBe(true);
  });
});
