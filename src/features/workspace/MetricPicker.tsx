import { metricCatalog, type DashboardMetric } from '../../lib/workspace/model'

export function MetricPicker({
  value,
  onChange,
}: {
  value: DashboardMetric[]
  onChange: (value: DashboardMetric[]) => void
}) {
  return (
    <fieldset className="workspace-metrics metric-picker">
      <legend className="metric-picker__legend">
        Choose what the briefing shows
      </legend>
      <div className="workspace-metric-options metric-picker__options">
        {metricCatalog.map((metric) => {
          const selected = value.includes(metric.id)
          return (
            <label
              key={metric.id}
              className="workspace-metric-option metric-option"
              data-selected={selected}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, metric.id]
                      : value.filter((id) => id !== metric.id),
                  )
                }
              />
              <span>
                <strong>{metric.name}</strong>
                <small>{metric.description}</small>
              </span>
            </label>
          )
        })}
      </div>
      {value.length === 0 && (
        <p role="alert" className="body-copy metric-picker__alert">
          Pick at least one insight to build the briefing.
        </p>
      )}
    </fieldset>
  )
}
