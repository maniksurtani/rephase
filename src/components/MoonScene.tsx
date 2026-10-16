export function MoonScene() {
  return (
    <svg className="moon-scene" viewBox="0 0 510 290" aria-hidden="true">
      <defs>
        <radialGradient id="moon-glow">
          <stop stopColor="#bda6ef" stopOpacity=".19" />
          <stop offset="1" stopColor="#bda6ef" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="moon-fill" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#e3d8f9" />
          <stop offset="1" stopColor="#8071a9" />
        </linearGradient>
        <mask id="crescent-mask">
          <rect width="510" height="290" fill="white" />
          <circle cx="302" cy="98" r="62" fill="black" />
        </mask>
      </defs>
      <circle cx="275" cy="140" r="130" fill="url(#moon-glow)" />
      <ellipse
        cx="268"
        cy="154"
        rx="173"
        ry="61"
        fill="none"
        stroke="#b6a2e7"
        strokeOpacity=".14"
        transform="rotate(-24 268 154)"
      />
      <ellipse
        cx="268"
        cy="154"
        rx="208"
        ry="84"
        fill="none"
        stroke="#b6a2e7"
        strokeOpacity=".07"
        transform="rotate(-24 268 154)"
      />
      <circle cx="270" cy="130" r="68" fill="url(#moon-fill)" mask="url(#crescent-mask)" />
      <circle cx="401" cy="94" r="4" fill="#e9b985" />
      <circle cx="111" cy="205" r="3" fill="#c7b6ee" />
      <circle cx="367" cy="220" r="2" fill="#c7b6ee" />
      <path
        d="M153 70v8m-4-4h8M405 165v10m-5-5h10M340 45v6m-3-3h6"
        stroke="#d9c9f5"
        strokeOpacity=".6"
        strokeLinecap="round"
      />
      <circle cx="110" cy="118" r="1.5" fill="#ab98cd" />
      <circle cx="194" cy="247" r="1.5" fill="#ab98cd" />
      <circle cx="435" cy="245" r="1.5" fill="#ab98cd" />
      <path
        d="m115 206 23-13 5 6-17 9-9 11-5-3 4-9-10-3 3-4Z"
        fill="#c9bce6"
        transform="rotate(13 126 207)"
      />
    </svg>
  );
}
