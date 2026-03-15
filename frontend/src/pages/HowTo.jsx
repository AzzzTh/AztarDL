import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

export default function HowTo() {
  const { t } = useApp();
  const hw = t.howTo;

  return (
    <div className="howto-page">

      {/* Back link */}
      <Link
        to="/"
        className="nav-link"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: '2rem' }}
      >
        <ArrowLeft size={14} />
        AztarDL
      </Link>

      {/* Header */}
      <div className="howto-header">
        <p className="howto-subtitle">◆ {hw.subtitle} ◆</p>
        <h1 className="howto-title">{hw.title}</h1>
      </div>

      {/* Steps */}
      <div className="steps-list">
        {hw.steps.map((step) => (
          <div className="step-card" key={step.n}>
            <span className="step-number">{step.n}</span>
            <div className="step-content">
              <h2 className="step-title">{step.title}</h2>
              <p className="step-desc">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tips */}
      <div className="tips-section">
        <p className="tips-title">{hw.tips.title}</p>
        <div className="tips-list">
          {hw.tips.items.map((tip, i) => (
            <div className="tip-item" key={i}>
              <div className="tip-diamond" />
              <span>{tip}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
