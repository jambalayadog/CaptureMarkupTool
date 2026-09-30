import { useEffect, useState } from 'react'

export function Num(props: {
  label?: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  title?: string
  slider?: boolean
  onChange: (v: number) => void
}): React.JSX.Element {
  const { label, value, min, max, step = 1, suffix, title, slider = true, onChange } = props
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(Math.round(value * 100) / 100)), [value])
  const commit = (s: string): void => {
    const v = parseFloat(s)
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
    else setText(String(value))
  }
  return (
    <label className="num" title={title}>
      {label && <span className="num-label">{label}</span>}
      {slider && (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      )}
      <input
        className="num-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? step * 10 : step)
            onChange(Math.min(max, Math.max(min, value + d)))
          }
        }}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </label>
  )
}

export function Toggle(props: { active: boolean; title: string; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button className={props.active ? 'toggle on' : 'toggle'} title={props.title} onClick={props.onClick}>
      {props.children}
    </button>
  )
}

export function Seg<T extends string>(props: {
  value: T
  options: { value: T; label: React.ReactNode; title?: string }[]
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div className="seg">
      {props.options.map((o) => (
        <button key={o.value} title={o.title} className={o.value === props.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Sel<T extends string>(props: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  title?: string
}): React.JSX.Element {
  return (
    <select
      className="sel"
      value={props.value}
      title={props.title}
      onChange={(e) => {
        props.onChange(e.target.value as T)
        e.target.blur() // hand the keyboard back to the editor
      }}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Divider(): React.JSX.Element {
  return <div className="divider" />
}

export function IconBtn(props: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <button className={`icon-btn ${props.className ?? ''}`} title={props.title} onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  )
}
