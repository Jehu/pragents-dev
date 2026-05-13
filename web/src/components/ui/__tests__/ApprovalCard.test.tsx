import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ApprovalCard } from '../ApprovalCard';

afterEach(cleanup);

describe('ApprovalCard', () => {
  const makeProps = () => ({
    title: 'Test approval',
    body: <span>Some details</span>,
    onApprove: vi.fn(),
    onReject: vi.fn(),
  });

  it('renders title and body', () => {
    const { getByText } = render(<ApprovalCard variant="plan" {...makeProps()} />);
    expect(getByText('Test approval')).toBeTruthy();
    expect(getByText('Some details')).toBeTruthy();
  });

  it('renders plan variant label', () => {
    const { container } = render(<ApprovalCard variant="plan" {...makeProps()} />);
    const span = container.querySelector('span.uppercase') as HTMLElement;
    expect(span.textContent).toBe('plan');
  });

  it('renders gate variant label', () => {
    const { container } = render(<ApprovalCard variant="gate" {...makeProps()} />);
    const span = container.querySelector('span.uppercase') as HTMLElement;
    expect(span.textContent).toBe('gate');
  });

  it('renders skill variant label', () => {
    const { container } = render(<ApprovalCard variant="skill" {...makeProps()} />);
    const span = container.querySelector('span.uppercase') as HTMLElement;
    expect(span.textContent).toBe('skill');
  });

  it('calls onApprove when approve button clicked', () => {
    const onApprove = vi.fn();
    const { getByText } = render(<ApprovalCard variant="plan" {...makeProps()} onApprove={onApprove} />);
    fireEvent.click(getByText('Approve'));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it('calls onReject when reject button clicked', () => {
    const onReject = vi.fn();
    const { getByText } = render(<ApprovalCard variant="gate" {...makeProps()} onReject={onReject} />);
    fireEvent.click(getByText('Reject'));
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('renders tertiary button when onTertiary provided', () => {
    const onTertiary = vi.fn();
    const { getByText } = render(
      <ApprovalCard variant="skill" {...makeProps()} onTertiary={onTertiary} tertiaryLabel="Preview" />,
    );
    expect(getByText('Preview')).toBeTruthy();
    fireEvent.click(getByText('Preview'));
    expect(onTertiary).toHaveBeenCalledOnce();
  });

  it('disables buttons when disabled=true', () => {
    const { getByText } = render(<ApprovalCard variant="plan" {...makeProps()} disabled />);
    expect((getByText('Approve') as HTMLButtonElement).disabled).toBe(true);
    expect((getByText('Reject') as HTMLButtonElement).disabled).toBe(true);
  });
});
