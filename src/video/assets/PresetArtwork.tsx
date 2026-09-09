import {presetString, resolvePresetValues, scalarAt, type PresetDefinition, type PresetValues} from '../../../shared/asset-presets';

/** Pure SVG artwork, also used for library thumbnails. All motion comes from explicit progress. */
export function PresetArtwork({definition, values: input, progress, width, height}: {definition: PresetDefinition; values: PresetValues; progress: number; width: number; height: number}) {
  const values = resolvePresetValues(definition, input);
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" style={{display: 'block', overflow: 'visible'}} aria-hidden="true">
    {definition.layers.map(layer => {
      const n = (field: 'x' | 'y' | 'width' | 'height' | 'opacity' | 'rotation' | 'scale' | 'fontSize' | 'radius' | 'strokeWidth') => scalarAt(layer[field], progress, values);
      const x = n('x') / 100 * width; const y = n('y') / 100 * height;
      const w = Math.max(0, Math.min(400, n('width'))) / 100 * width; const h = Math.max(0, Math.min(400, n('height'))) / 100 * height;
      const fill = presetString(layer.fill, values); const stroke = layer.stroke ? presetString(layer.stroke, values) : undefined;
      const size = Math.max(.1, Math.min(100, n('fontSize'))) / 100 * height;
      const lines = presetString(layer.text, values).split('\n');
      return <g key={layer.id} transform={`translate(${x} ${y}) rotate(${n('rotation')}) scale(${Math.max(0, Math.min(20, n('scale')))})`} opacity={Math.max(0, Math.min(1, n('opacity')))} fill={fill} stroke={stroke} strokeWidth={Math.max(0, Math.min(20, n('strokeWidth'))) / 100 * height}>
        {layer.type === 'rect' ? <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={Math.max(0, n('radius')) / 100 * height}/> : layer.type === 'ellipse' ? <ellipse rx={w / 2} ry={h / 2}/> : <text fontFamily="Arial, Helvetica, sans-serif" fontSize={size} fontWeight={layer.weight} textAnchor={layer.align === 'left' ? 'start' : layer.align === 'right' ? 'end' : 'middle'}>{lines.map((line, index) => <tspan key={index} x={layer.align === 'left' ? -w / 2 : layer.align === 'right' ? w / 2 : 0} y={(index - (lines.length - 1) / 2) * size * 1.15 + size * .35}>{line}</tspan>)}</text>}
      </g>;
    })}
  </svg>;
}
