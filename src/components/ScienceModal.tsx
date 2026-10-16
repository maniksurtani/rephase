import { ArrowRight, ArrowUpRight, Coffee, Info, Moon, Sparkles, Sun } from 'lucide-react';
import { Modal } from './Modal';

export function ScienceModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="The science of a softer landing" onClose={onClose} className="science-modal">
      <div className="science-intro">
        <span className="science-intro-icon">
          <Sparkles size={27} />
        </span>
        <p>
          Jet lag happens when your internal clock and the time around you fall out of step.
          Carefully timed light and sleep can help bring them closer together.
        </p>
      </div>
      <div className="science-principles">
        <article>
          <Sun size={22} />
          <div>
            <h3>Light sets the pace</h3>
            <p>
              Light can move your body clock earlier or later depending on when it reaches you.
              That’s why your plan includes both light exposure and light avoidance.
            </p>
          </div>
        </article>
        <article>
          <Moon size={22} />
          <div>
            <h3>Sleep protects the journey</h3>
            <p>
              A consistent sleep opportunity supports alertness and recovery. Your plan combines
              your sleep needs with gradual adjustment across the full itinerary.
            </p>
          </div>
        </article>
        <article>
          <Coffee size={22} />
          <div>
            <h3>Optional tools, carefully timed</h3>
            <p>
              Caffeine may support alertness while affecting later sleep. Melatonin timing matters;
              optional guidance uses the CDC’s informational 0.5–1 mg range, without personalized
              dosing.
            </p>
          </div>
        </article>
      </div>
      <div className="science-limitations">
        <Info size={18} />
        <div>
          <h3>What this plan can tell you</h3>
          <p>
            Rephase offers a published light-driven circadian model and conservative planning rules.
            Circadian phase and adjustment are estimates from your usual sleep schedule, rather than
            measurements. The app has not been clinically validated and does not reproduce
            Timeshifter’s proprietary algorithm.
          </p>
          <p>
            Flight schedules, daylight exposure, actual sleep, health conditions, and individual
            responses can change the outcome. Review plan notes, and use professional advice for
            medical decisions.
          </p>
        </div>
      </div>
      <p>
        <a href="/science.html">
          Read the full Science page, including studies and model assumptions{' '}
          <ArrowUpRight size={14} />
        </a>
      </p>
      <h3 className="source-heading">Read the evidence</h3>
      <div className="source-links">
        <a
          href="https://www.cdc.gov/yellow-book/hcp/travel-air-sea/jet-lag-disorder.html"
          target="_blank"
          rel="noreferrer"
        >
          <span>
            <strong>CDC Yellow Book</strong>
            <small>Jet lag disorder: light, sleep, caffeine, and melatonin</small>
          </span>
          <ArrowUpRight size={18} />
        </a>
        <a
          href="https://www.nccih.nih.gov/health/melatonin-what-you-need-to-know"
          target="_blank"
          rel="noreferrer"
        >
          <span>
            <strong>NCCIH · Melatonin</strong>
            <small>Evidence, suitability, interactions, and product quality</small>
          </span>
          <ArrowUpRight size={18} />
        </a>
      </div>
      <div className="modal-footer">
        <button type="button" className="button primary" onClick={onClose}>
          Back to my rhythm <ArrowRight size={16} />
        </button>
      </div>
    </Modal>
  );
}
