import { useEditor } from './state'
import { TOOL_GROUPS } from './tools'

export function ToolRail(): React.JSX.Element {
  const ed = useEditor()
  return (
    <nav className="toolrail">
      {TOOL_GROUPS.map((group, i) => (
        <div className="tool-group" key={i}>
          {group.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                className={ed.tool === t.id ? 'tool active' : 'tool'}
                title={t.key ? `${t.label} (${t.key})` : t.label}
                onClick={() => ed.setTool(t.id)}
              >
                <Icon size={18} strokeWidth={1.8} />
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
