import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  subline?: string;
  mono?: boolean;
  className?: string;
}

export function StatCard({ label, value, subline, mono = false, className = '' }: StatCardProps) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-lg p-4 ${className}`}>
      <div className="text-xs text-zinc-400 mb-1">{label}</div>
      <div className={`text-3xl font-bold text-zinc-100 ${mono ? 'font-mono' : ''}`}>{value}</div>
      {subline && <div className="text-xs text-zinc-500 mt-1">{subline}</div>}
    </div>
  );
}
