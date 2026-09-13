import type {Mask} from './visual-editing';
import {maskGeometry, nativeMaskVertexBudget} from './mask-geometry';
import {glslNumber as n} from './gpu-color-effects';

// Gauss-Legendre nodes integrate one Gaussian axis; the other axis uses its
// analytic CDF. Constants/vertices only: no CPU mask pixels or texture atlas.
export function gaussianQuadrature(count = 32): [number, number][] {
  return Array.from({length: count}, (_, i) => {
    let x = Math.cos(Math.PI * (i + .75) / (count + .5)); let derivative = 0;
    for(let iteration = 0; iteration < 20; iteration++) {
      let a = 1; let b = x;
      for(let k = 2; k <= count; k++) {const c = ((2 * k - 1) * x * b - (k - 1) * a) / k; a = b; b = c;}
      derivative = count * (x * b - a) / (x * x - 1);
      const delta = b / derivative; x -= delta; if(Math.abs(delta) < 1e-14) break;
    }
    return [x, 2 / ((1 - x * x) * derivative * derivative)];
  });
}

/** Matches SVG nonzero fill and Gaussian alpha blur, including the existing
 * filter region (-100%/300%). Bounded quadrature approximates the Gaussian;
 * it is not a distance-based feather, which erases thin/concave shapes.
 */
export function gpuMaskShader(mask: Mask, canvas: {width: number; height: number}): string {
  if(mask.shape === 'polygon' && mask.points.length > nativeMaskVertexBudget) throw new Error(`Native masks allow ${nativeMaskVertexBudget} vertices per polygon to bound GPU work. Simplify this mask or use the compatible renderer.`);
  const {x, y, width, height, points, bounds: b, sigma} = maskGeometry(mask, canvas);
  const vec = (a: number, b: number) => `vec2(${n(a)},${n(b)})`;
  const low = vec(b.left, b.top); const high = vec(b.right, b.bottom);
  const degenerate = b.left === b.right || b.top === b.bottom;
  const polygon = mask.shape === 'polygon';
  const inside = degenerate ? 'return false;' : polygon ? `int winding=0;
    for(int i=0;i<${points.length};i++){vec2 a=fc_mask_points[i];vec2 z=fc_mask_points[(i+1)%${points.length}];
      float side=(z.x-a.x)*(p.y-a.y)-(p.x-a.x)*(z.y-a.y);
      if(a.y<=p.y&&z.y>p.y&&side>0.0)winding++;if(a.y>p.y&&z.y<=p.y&&side<0.0)winding--;
    }return winding!=0;` : mask.shape === 'rectangle' ? `return all(greaterThanEqual(p,${low}))&&all(lessThan(p,${high}));`
      : `return length((p-${vec(x, y)})/${vec(width / 2, height / 2)})<1.0;`;
  const row = polygon ? `
    vec2 hits[${points.length}];int count=0;
    for(int i=0;i<${points.length};i++){vec2 a=fc_mask_points[i];vec2 z=fc_mask_points[(i+1)%${points.length}];
      if((a.y<=row&&z.y>row)||(a.y>row&&z.y<=row)){
        float at=a.x+(row-a.y)*(z.x-a.x)/(z.y-a.y);int j=count;
        while(j>0&&hits[j-1].x>at){hits[j]=hits[j-1];j--;}
        hits[j]=vec2(at,z.y>a.y?1.0:-1.0);count++;
      }
    }
    int winding=0;float total=0.0;
    for(int i=0;i<count;i++){winding+=int(hits[i].y);if(winding!=0&&i+1<count)total+=fc_mask_cdf((hits[i+1].x-p.x)/s.x)-fc_mask_cdf((hits[i].x-p.x)/s.x);}
    return total;` : `
    float t=(row-${n(y)})/${n(height / 2)};
    float radius=${n(width / 2)}*sqrt(max(0.0,1.0-t*t));
    return fc_mask_cdf((${n(x)}+radius-p.x)/s.x)-fc_mask_cdf((${n(x)}-radius-p.x)/s.x);`;
  return `
    ${polygon ? `const vec2 fc_mask_points[${points.length}]=vec2[](${points.map(p => vec(p.x, p.y)).join(',')});` : ''}
    bool fc_mask_inside(vec2 p){${inside}}
    ${!degenerate && mask.shape !== 'rectangle' ? `float fc_mask_boundary_distance(vec2 p){${polygon ? `float d=1e20;for(int i=0;i<${points.length};i++){vec2 a=fc_mask_points[i];vec2 v=fc_mask_points[(i+1)%${points.length}]-a;vec2 q=p-a;d=min(d,length(q-v*clamp(dot(q,v)/max(dot(v,v),1e-20),0.0,1.0)));}return d;`
      : `return abs(length((p-${vec(x, y)})/${vec(width / 2, height / 2)})-1.0)*${n(Math.min(width, height) / 2)};`}}` : ''}
    ${sigma > 0 && !degenerate ? `
      float fc_mask_cdf(float v){float t=1.0/(1.0+0.2316419*abs(v));float d=0.3989422804014327*exp(-0.5*v*v);
        float tail=d*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return v>=0.0?1.0-tail:tail;}
      ${mask.shape !== 'rectangle' ? `float fc_mask_row(vec2 p,vec2 s,float row){${row}}
      const vec2 fc_mask_taps[32]=vec2[](${gaussianQuadrature().map(t => vec(...t)).join(',')});` : ''}
      float fc_mask_blur(vec2 p,vec2 s){
        // feGaussianBlur output is clipped to the SVG group's filter region.
        if(any(lessThan(p,${low}-(${high}-${low})))||any(greaterThan(p,${high}+(${high}-${low}))))return 0.0;
        ${mask.shape === 'rectangle' ? `return (fc_mask_cdf((${n(b.right)}-p.x)/s.x)-fc_mask_cdf((${n(b.left)}-p.x)/s.x))*(fc_mask_cdf((${n(b.bottom)}-p.y)/s.y)-fc_mask_cdf((${n(b.top)}-p.y)/s.y));` : `
        if(p.x<${n(b.left)}-4.0*s.x||p.x>${n(b.right)}+4.0*s.x)return 0.0;
        if(fc_mask_boundary_distance(p)>4.0*max(s.x,s.y))return float(fc_mask_inside(p));
        float lo=max(${n(b.top)},p.y-4.0*s.y);float hi=min(${n(b.bottom)},p.y+4.0*s.y);if(hi<=lo)return 0.0;
        float midpoint=(lo+hi)*0.5;float halfWidth=(hi-lo)*0.5;float total=0.0;
        for(int i=0;i<32;i++){float row=midpoint+halfWidth*fc_mask_taps[i].x;float t=(row-p.y)/s.y;
          total+=fc_mask_taps[i].y*exp(-0.5*t*t)*fc_mask_row(p,s,row);
        }return clamp(total*halfWidth/(s.y*2.506628274631),0.0,1.0);`}
      }` : ''}
    float fc_mask(vec2 p,vec2 dx,vec2 dy){
      if(any(lessThan(p,vec2(0.0)))||any(greaterThanEqual(p,${vec(canvas.width, canvas.height)})))return 0.0;
      float coverage=0.0;
      ${degenerate ? '' : sigma > 0 ? `vec2 s=sqrt(vec2(${n(sigma * sigma)})+(dx*dx+dy*dy)/12.0);coverage=fc_mask_blur(p,s);`
        : 'for(int y=0;y<4;y++)for(int x=0;x<4;x++)coverage+=float(fc_mask_inside(p+dx*((float(x)+0.5)/4.0-0.5)+dy*((float(y)+0.5)/4.0-0.5)))/16.0;'}
      return ${mask.inverted ? '1.0-coverage' : 'coverage'};
    }`;
}
