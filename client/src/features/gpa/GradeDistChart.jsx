import { useEffect, useRef } from 'react';

export default function GradeDistChart({ semesters }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let chart;
    let cancelled = false;

    if (!semesters || semesters.length === 0 || !canvasRef.current) return;

    import('chart.js/auto').then(({ default: Chart }) => {
      if (cancelled || !canvasRef.current) return;

      const isDark = document.body.classList.contains('theme-dark');
      const textColor = isDark ? '#c0b8ae' : '#625f59';

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
                '#285943', // A
                '#4f745f', // B+
                '#718477', // B
                '#9b8f7b', // C+
                '#b89a56', // C
                '#b66d4a', // D+
                '#a54532', // D
                '#8c1515'  // F
              ],
              borderWidth: 0
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
                boxWidth: 10,
                font: { size: 10 }
              }
            }
          },
          cutout: '65%'
        }
      });
    });

    return () => {
      cancelled = true;
      chart?.destroy();
    };
  }, [semesters]);

  return <canvas ref={canvasRef} id="gradeDistChart" />;
}
