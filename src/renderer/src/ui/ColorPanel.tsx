import { ArrowLeftRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { PALETTES } from '../core/constants'
import { hexToRgb, hsvToRgb, isHex, normalizeHex, rgbToHex, rgbToHsv } from '../core/util'
import { Sel } from './controls'
import { useEditor } from './state'

type Target = 'primary' | 'secondary'

function useDrag(onPoint: (x: number, y: number) => void): (e: React.PointerEvent<HTMLElement>) => void {
  return (e) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const apply = (ev: PointerEvent | React.PointerEvent): void => {
      const r = el.getBoundingClientRect()
      onPoint(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)))
    }
    apply(e)
    const move = (ev: PointerEvent): void => apply(ev)
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
}

export function ColorPanel(): React.JSX.Element {
  const ed = useEditor()
  const [target, setTarget] = useState<Target>('primary')
  const color = target === 'primary' ? ed.primary : ed.secondary
  const [hsv, setHsv] = useState(() => rgbToHsv(...hexToRgb(color)))
  const lastSet = useRef(color)
  const [hex, setHex] = useState(color)

  // Follow external colour changes (palette, eyedropper) without losing hue on greys.
  useEffect(() => {
    setHex(color)
    if (color !== lastSet.current) {
      const next = rgbToHsv(...hexToRgb(color))
      setHsv((prev) => (next[1] === 0 || next[2] === 0 ? [prev[0], next[1], next[2]] : next))
      lastSet.current = color
    }
  }, [color])

  const apply = (h: number, s: number, v: number): void => {
    setHsv([h, s, v])
    const c = rgbToHex(...hsvToRgb(h, s, v))
    lastSet.current = c
    if (target === 'primary') ed.setPrimary(c)
    else ed.setSecondary(c)
  }

  const svDown = useDrag((x, y) => apply(hsv[0], x, 1 - y))
  const hueDown = useDrag((x) => apply(Math.min(359.9, x * 360), hsv[1], hsv[2]))
  const pick = (c: string, secondary: boolean): void => {
    if (secondary) ed.setSecondary(c)
    else ed.setPrimary(c)
    ed.pushRecent(c)
  }

  return (
    <section className="panel color-panel">
      <div className="panel-head">
        <span>Color</span>
      </div>
      <div className="color-top">
        <div className="swatches">
          <button
            className={target === 'secondary' ? 'swatch secondary on' : 'swatch secondary'}
            style={{ background: ed.secondary }}
            title="Secondary colour (fills, backgrounds, right-click paint)"
            onClick={() => setTarget('secondary')}
          />
          <button
            className={target === 'primary' ? 'swatch primary on' : 'swatch primary'}
            style={{ background: ed.primary }}
            title="Primary colour"
            onClick={() => setTarget('primary')}
          />
          <button className="swap" title="Swap colours (X)" onClick={() => ed.swapColors()}>
            <ArrowLeftRight size={12} />
          </button>
        </div>
        <input
          className="hex-input"
          value={hex}
          spellCheck={false}
          onChange={(e) => {
            setHex(e.target.value)
            if (isHex(e.target.value) && e.target.value.replace('#', '').length === 6) {
              const c = normalizeHex(e.target.value)
              if (target === 'primary') ed.setPrimary(c)
              else ed.setSecondary(c)
            }
          }}
          onBlur={() => setHex(color)}
        />
      </div>
      <div className="sv" style={{ background: `hsl(${hsv[0]}, 100%, 50%)` }} onPointerDown={svDown}>
        <div className="sv-white" />
        <div className="sv-black" />
        <div className="sv-thumb" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: color }} />
      </div>
      <div className="hue" onPointerDown={hueDown}>
        <div className="hue-thumb" style={{ left: `${(hsv[0] / 360) * 100}%` }} />
      </div>
      <div className="palette-head">
        <Sel
          value={ed.palette}
          options={Object.keys(PALETTES).map((k) => ({ value: k, label: k }))}
          onChange={(v) => {
            ed.palette = v
            ed.emit()
          }}
        />
      </div>
      <div className="palette">
        {PALETTES[ed.palette].map((c, i) => (
          <button
            key={i}
            className="pal"
            style={{ background: c }}
            title={`${c} · click for primary, right-click for secondary`}
            onClick={() => pick(c, false)}
            onContextMenu={(e) => {
              e.preventDefault()
              pick(c, true)
            }}
          />
        ))}
      </div>
      {ed.recent.length > 0 && (
        <div className="recent">
          {ed.recent.map((c) => (
            <button
              key={c}
              className="pal small"
              style={{ background: c }}
              title={c}
              onClick={() => pick(c, false)}
              onContextMenu={(e) => {
                e.preventDefault()
                pick(c, true)
              }}
            />
          ))}
        </div>
      )}
    </section>
  )
}
