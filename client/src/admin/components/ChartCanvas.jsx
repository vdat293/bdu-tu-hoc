import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';

export default function ChartCanvas({
  type = 'line',
  data,
  options,
  ariaLabel = 'Biểu đồ thống kê',
  height = 290
}) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [themeRev, setThemeRev] = useState(0);

  useEffect(() => {
    const Observer = typeof window !== 'undefined' ? window.MutationObserver : undefined;
    if (!Observer || !document?.documentElement) return undefined;
    const observer = new Observer(() => {
      setThemeRev((rev) => rev + 1);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx) return undefined;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    try {
      chartRef.current = new Chart(ctx, {
        type,
        data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          ...options
        }
      });
    } catch {
      chartRef.current = null;
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [type, data, options, themeRev]);

  return (
    <div className="chart-wrapper" style={{ height: `${height}px` }}>
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />
    </div>
  );
}
