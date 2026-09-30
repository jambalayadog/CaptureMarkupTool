import { Copy, Eye, EyeOff, ImagePlus, Lock, LockOpen, Merge, Shapes, SquarePlus, Trash } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BLEND_MODES } from '../core/constants'
import { mergeDown } from '../core/imageOps'
import { renderThumb } from '../core/render'
import type { BlendMode, Layer } from '../core/types'
import { IconBtn, Num, Sel } from './controls'
import { editor, useEditor } from './state'

function Thumb({ layer, version }: { layer: Layer; version: number }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const d = editor.d
    if (d && ref.current) renderThumb(d, layer, ref.current)
  }, [layer, version])
  return <canvas ref={ref} className="thumb" width={44} height={32} />
}

function Row({ layer, index }: { layer: Layer; index: number }): React.JSX.Element {
  const ed = useEditor()
  const d = ed.d!
  const [editing, setEditing] = useState(false)
  const [over, setOver] = useState<'above' | 'below' | null>(null)
  const active = d.activeLayerId === layer.id
  return (
    <div
      className={['layer', active ? 'active' : '', over ? `drop-${over}` : '', layer.visible ? '' : 'hidden'].join(' ')}
      draggable={!editing}
      onClick={() => ed.setActiveLayer(layer.id)}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-layer', layer.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-layer')) return
        e.preventDefault()
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        setOver(e.clientY < r.top + r.height / 2 ? 'above' : 'below')
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('application/x-layer')
        if (!id) return
        e.preventDefault()
        e.stopPropagation()
        const from = d.layers.findIndex((l) => l.id === id)
        // rows are shown top-first, so "above" means a higher index
        let to = over === 'above' ? index + 1 : index
        if (from < to) to--
        setOver(null)
        ed.moveLayer(id, to)
      }}
    >
      <button
        className="layer-eye"
        title={layer.visible ? 'Hide layer' : 'Show layer'}
        onClick={(e) => {
          e.stopPropagation()
          ed.setLayerProps(layer.id, { visible: !layer.visible })
        }}
      >
        {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      <Thumb layer={layer} version={ed.version} />
      <div className="layer-name" onDoubleClick={() => setEditing(true)}>
        {editing ? (
          <input
            autoFocus
            defaultValue={layer.name}
            onBlur={(e) => {
              setEditing(false)
              if (e.target.value.trim() && e.target.value !== layer.name) ed.setLayerProps(layer.id, { name: e.target.value.trim() })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <>
            <span>{layer.name}</span>
            {layer.kind === 'vector' && (
              <small title="Annotation layer: objects stay editable">
                <Shapes size={11} /> {layer.objects.length}
              </small>
            )}
          </>
        )}
      </div>
      <button
        className={layer.locked ? 'layer-lock on' : 'layer-lock'}
        title={layer.locked ? 'Unlock layer' : 'Lock layer'}
        onClick={(e) => {
          e.stopPropagation()
          ed.setLayerProps(layer.id, { locked: !layer.locked })
        }}
      >
        {layer.locked ? <Lock size={13} /> : <LockOpen size={13} />}
      </button>
    </div>
  )
}

export function LayersPanel(): React.JSX.Element {
  const ed = useEditor()
  const d = ed.d!
  const active = ed.activeLayer()
  const idx = active ? d.layers.indexOf(active) : -1
  return (
    <section className="panel layers-panel">
      <div className="panel-head">
        <span>Layers</span>
      </div>
      {active && (
        <div className="layer-props">
          <Sel
            value={active.blend}
            options={BLEND_MODES}
            onChange={(v: BlendMode) => ed.setLayerProps(active.id, { blend: v })}
            title="Blend mode"
          />
          <Num
            value={Math.round(active.opacity * 100)}
            min={0}
            max={100}
            suffix="%"
            title="Layer opacity"
            onChange={(v) => ed.setLayerProps(active.id, { opacity: v / 100 }, `opacity-${active.id}`)}
          />
        </div>
      )}
      <div className="layer-list">
        {d.layers
          .map((l, i) => ({ l, i }))
          .reverse()
          .map(({ l, i }) => (
            <Row key={l.id} layer={l} index={i} />
          ))}
      </div>
      <div className="layer-actions">
        <IconBtn title="New pixel layer (Ctrl+Shift+N)" onClick={() => ed.addRasterLayer()}>
          <ImagePlus size={15} />
        </IconBtn>
        <IconBtn title="New annotation layer" onClick={() => ed.addVectorLayer()}>
          <SquarePlus size={15} />
        </IconBtn>
        <IconBtn title="Duplicate layer (Ctrl+J)" onClick={() => ed.duplicateLayer(d.activeLayerId)}>
          <Copy size={15} />
        </IconBtn>
        <IconBtn title="Merge down (Ctrl+E)" onClick={() => mergeDown(ed, d.activeLayerId)} disabled={idx < 1}>
          <Merge size={15} />
        </IconBtn>
        <div className="spacer" />
        <IconBtn title="Delete layer" onClick={() => ed.deleteLayer(d.activeLayerId)} disabled={d.layers.length < 2}>
          <Trash size={15} />
        </IconBtn>
      </div>
    </section>
  )
}
