/**
 * Geometry of the progress charts.
 *
 * They are hand-drawn SVG, so nothing checks the arithmetic but this: a
 * divide-by-zero produces `NaN` in a coordinate, which renders as an invisible
 * chart and no error anywhere. These are the inputs that used to do it — one
 * point, a flat line, an untrained week — plus the rule that everything drawn
 * stays inside the box.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Bars, Sparkline, TrendChart } from '../src/ui/components/Chart';

const kilos = (value: number) => `${value} kg`;

function coordinates(markup: string): number[] {
  return [...markup.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

describe('TrendChart', () => {
  it('draws every point inside the viewBox', () => {
    render(
      <TrendChart
        label="Volumen"
        format={kilos}
        points={[
          { label: 'S1', value: 1000 },
          { label: 'S2', value: 1200 },
          { label: 'S3', value: 900 },
        ]}
      />,
    );

    const line = document.querySelector('polyline')?.getAttribute('points') ?? '';
    const numbers = coordinates(line);
    expect(numbers.length).toBe(6);
    expect(numbers.every(Number.isFinite)).toBe(true);
    // 320 x 150 box, with padding: nothing may escape it.
    expect(Math.max(...numbers)).toBeLessThanOrEqual(320);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
  });

  it('survives a single point without dividing by zero', () => {
    render(<TrendChart label="Volumen" format={kilos} points={[{ label: 'S1', value: 500 }]} />);
    const line = document.querySelector('polyline')?.getAttribute('points') ?? '';
    expect(line).not.toContain('NaN');
    expect(coordinates(line).every(Number.isFinite)).toBe(true);
  });

  it('reads out the most recent point, since that is the one you came for', () => {
    render(
      <TrendChart
        label="Volumen"
        format={kilos}
        points={[
          { label: 'S1', value: 1000 },
          { label: 'S2', value: 1200 },
        ]}
      />,
    );
    expect(screen.getByText('1200 kg')).toBeInTheDocument();
  });

  it('renders nothing rather than an empty frame when there is no data', () => {
    const { container } = render(<TrendChart label="Volumen" format={kilos} points={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('Sparkline', () => {
  it('draws a flat lift flat instead of dividing by a zero range', () => {
    render(<Sparkline values={[100, 100, 100]} label="Press" />);
    const line = document.querySelector('polyline')?.getAttribute('points') ?? '';
    expect(line).not.toContain('NaN');

    const ys = coordinates(line).filter((_, index) => index % 2 === 1);
    expect(new Set(ys).size).toBe(1);
  });

  it('needs two sessions before there is a trend to draw', () => {
    const { container } = render(<Sparkline values={[100]} label="Press" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('Bars', () => {
  it('tells an untrained day apart from a light one', () => {
    const { container } = render(
      <Bars
        label="Sesiones"
        format={kilos}
        points={[
          { label: 'D1', value: 0 },
          { label: 'D2', value: 50 },
          { label: 'D3', value: 2000 },
        ]}
      />,
    );

    const bars = [...container.querySelectorAll('span[title]')];
    expect(bars).toHaveLength(3);
    // Zero is drawn in the empty colour; a light day keeps the data colour and
    // a visible stub, so "nothing" and "a little" never look the same.
    expect(bars[0]?.className).toContain('bg-iron-800');
    expect(bars[1]?.className).toContain('bg-signal-500');
    expect(bars[1]?.getAttribute('style')).toContain('3%');
  });
});
