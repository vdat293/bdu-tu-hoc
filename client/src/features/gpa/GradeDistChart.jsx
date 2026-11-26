import { useEffect, useRef, useState } from 'react';

export default function GradeDistChart({ semesters }) {
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
      const borderColor = isDark ? '#e4e4e7' : '#111111';

      const counts = { A: 0, 'B+': 0, B: 0, 'C+': 0, C: 0, 'D+': 0, D: 0, F: 0 };

      semesters.forEach((sem) => {
        (sem.ds_diem_mon_hoc || []).forEach((c) => {
          const letter = (c.diem_tk_chu || '').trim().toUpperCase();
          if (Object.prototype.hasOwnProperty.call(counts, letter)) {
            counts[letter]++;
          }
        });
      });

      chart = new Chart(canvasRef.current, {
        type: 'doughnut',
        data: {
          labels: Object.keys(counts),
          datasets: [
            {
              data: Object.values(counts),
              backgroundColor: [
                '#10b981', // A  (Emerald)
                '#1d4ed8', // B+ (BDU Blue)
                '#3b82f6', // B  (Bright Blue)
                '#8b5cf6', // C+ (Purple)
                '#facc15', // C  (Secondary Yellow)
                '#f59e0b', // D+ (Amber)
                '#fb7185', // D  (Coral)
                '#ef4444'  // F  (Rose Danger)
              ],
              borderColor,
              borderWidth: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: textColor,
                boxWidth: 11,
                font: { family: 'Manrope, sans-serif', size: 11, weight: '700' }
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
          },
          cutout: '62%'
        }
      });
    });

    return () => {
      cancelled = true;
      chart?.destroy();
    };
  }, [semesters, themeRev]);

  return <canvas ref={canvasRef} id="gradeDistChart" />;
}
