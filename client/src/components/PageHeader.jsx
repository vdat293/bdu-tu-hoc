export default function PageHeader({ eyebrow, title, description, actions }) {
  return <div className="section-header-box"><div><span className="section-kicker">{eyebrow}</span><h2 className="section-title">{title}</h2>{description && <p className="section-desc">{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</div>;
}
