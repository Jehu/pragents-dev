import React from 'react';

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function toSparkChars(data: number[]): string {
  if (data.length === 0) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  return data
    .map((v) => {
      const idx = Math.round(((v - min) / range) * (BLOCKS.length - 1));
      return BLOCKS[Math.max(0, Math.min(BLOCKS.length - 1, idx))];
    })
    .join('');
}

interface SparklineProps {
  data: number[];
  color?: string;
  className?: string;
}

export function Sparkline({ data, color = '#818cf8', className = '' }: SparklineProps) {
  return (
    <span
      className={`font-mono tracking-tighter leading-none ${className}`}
      style={{ color, letterSpacing: '-1px' }}
      aria-hidden="true"
    >
      {toSparkChars(data)}
    </span>
  );
}
