import type { HTMLAttributes, TableHTMLAttributes } from 'react';

export function Table({ className = '', ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table {...props} className={`w-full text-left text-sm ${className}`} />;
}

export function TableWrap({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`overflow-x-auto ${className}`} />;
}
