import { useEffect, useRef, useState } from 'react';

export default function GpaTrendChart({ semesters }) {
  const canvasRef = useRef(null);
  const [themeRev, setThemeRev] = useState(0);

  useEffect(() => {
    const Observer = typeof window !== 'undefined' ? window.MutationObserver : undefined;
    if (!Observer || !document.body) return undefined;
    const observer = new Observer(() => {
      setThemeRev((rev) => rev + 1);
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let chart;
    let cancelled = false;

    if (!semesters || semesters.length === 0 || !canvasRef.current) return;

    import('chart.js/auto').then(({ default: Chart }) => {
      if (cancelled || !canvasRef.current) return;

      const isDark = document.body.classList.contains('theme-dark');
      const textColor = isDark ? '#cbd5e1' : '#111111';
      const gridColor = isDark ? 'rgba(228, 228, 231, 0.14)' : 'rgba(17, 17, 17, 0.12)';
      const borderColor = isDark ? '#e4e4e7' : '#111111';
      const line10 = isDark ? '#3b82f6' : '#1d4ed8';
      const fill10 = isDark ? 'rgba(59, 130, 246, 0.16)' : 'rgba(29, 78, 216, 0.12)';
      const line4 = isDark ? '#fde047' : '#d97706';
      const fill4 = isDark ? 'rgba(253, 224, 71, 0.14)' : 'rgba(250, 204, 21, 0.16)';

      const chrono = [...semesters].reverse();
      const labels = chrono.map((s) => {
        const name = s.ten_hoc_ky || `HK ${s.hoc_ky}`;
        return name.replace('Học kỳ', 'HK').replace('Năm học', 'NH');
      });

      const gpa10Values = chrono.map((s) => parseFloat(s.dtb_hk_he10) || parseFloat(s.dtb_tich_luy_he_10) || null);
      const gpa4Values = chrono.map((s) => parseFloat(s.dtb_hk_he4) || parseFloat(s.dtb_tich_luy_he_4) || null);

      chart = new Chart(canvasRef.current, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'GPA HK (Thang 10)',
              data: gpa10Values,
              borderColor: line10,
              backgroundColor: fill10,
              borderWidth: 2.5,
              tension: 0,
              fill: true,
              yAxisID: 'y10',
              pointRadius: 5,
              pointHoverRadius: 7,
              pointBackgroundColor: line10,
              pointBorderColor: borderColor,
              pointBorderWidth: 2
            },
            {
              label: 'GPA HK (Thang 4)',
              data: gpa4Values,
              borderColor: line4,
              backgroundColor: fill4,
              borderWidth: 2.5,
              tension: 0,
              fill: true,
              yAxisID: 'y4',
              pointRadius: 5,
              pointHoverRadius: 7,
              pointBackgroundColor: line4,
              pointBorderColor: borderColor,
              pointBorderWidth: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              border: { color: borderColor, width: 2 },
              grid: { color: gridColor },
              ticks: { color: textColor, font: { family: 'JetBrains Mono, monospace', size: 10, weight: '600' } }
            },
            y10: {
              type: 'linear',
              position: 'left',
              min: 0,
              max: 10,
              border: { color: borderColor, width: 2 },
              ticks: { color: line10, font: { family: 'JetBrains Mono, monospace', size: 11, weight: '700' } },
              grid: { color: gridColor }
            },
            y4: {
              type: 'linear',
              position: 'right',
              min: 0,
              max: 4,
              border: { color: borderColor, width: 2 },
              ticks: { color: line4, font: { family: 'JetBrains Mono, monospace', size: 11, weight: '700' } },
              grid: { display: false }
            }
          },
          plugins: {
            legend: {
              labels: {
                color: textColor,
                font: { family: 'Manrope, sans-serif', weight: '700' }
              }
            },
            tooltip: {
              backgroundColor: isDark ? '#141820' : '#ffffff',
              titleColor: isDark ? '#f8fafc' : '#111111',
              bodyColor: isDark ? '#cbd5e1' : '#3f3f46',
              borderColor,
              borderWidth: 2,
              cornerRadius: 4
            }
          }
        }
      });
    });

    return () => {
      cancelled = true;
      chart?.destroy();
    };
  }, [semesters, themeRev]);

  return <canvas ref={canvasRef} id="gpaTrendChart" />;
}
