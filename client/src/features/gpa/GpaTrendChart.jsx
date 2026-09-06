import { useEffect, useRef } from 'react';

export default function GpaTrendChart({ semesters }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let chart;
    let cancelled = false;

    if (!semesters || semesters.length === 0 || !canvasRef.current) return;

    import('chart.js/auto').then(({ default: Chart }) => {
      if (cancelled || !canvasRef.current) return;

      const isDark = document.body.classList.contains('theme-dark');
      const textColor = isDark ? '#c0b8ae' : '#625f59';
      const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(79, 70, 61, 0.09)';

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
              borderColor: '#8c1515',
              backgroundColor: 'rgba(140, 21, 21, 0.08)',
              tension: 0.35,
              fill: true,
              yAxisID: 'y10',
              pointRadius: 4,
              pointHoverRadius: 6
            },
            {
              label: 'GPA HK (Thang 4)',
              data: gpa4Values,
              borderColor: '#9a6700',
              backgroundColor: 'rgba(154, 103, 0, 0.06)',
              tension: 0.35,
              fill: true,
              yAxisID: 'y4',
              pointRadius: 4,
              pointHoverRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              grid: { color: gridColor },
              ticks: { color: textColor, font: { size: 10 } }
            },
            y10: {
              type: 'linear',
              position: 'left',
              min: 0,
              max: 10,
              ticks: { color: '#8c1515' },
              grid: { color: gridColor }
            },
            y4: {
              type: 'linear',
              position: 'right',
              min: 0,
              max: 4,
              ticks: { color: '#9a6700' },
              grid: { display: false }
            }
          },
          plugins: {
            legend: {
              labels: {
                color: textColor,
                font: { family: 'Manrope', weight: '600' }
              }
            }
          }
        }
      });
    });

    return () => {
      cancelled = true;
      chart?.destroy();
    };
  }, [semesters]);

  return <canvas ref={canvasRef} id="gpaTrendChart" />;
}
