import type {ColorGradeStage} from '../../shared/color-grading';
import {colorGradeProgram, colorLutRgba} from '../../shared/color-grade-shader';

/** Browser compatibility adapter. Native export/monitor use the same shader math in Vulkan. */
export class ColorWebglRenderer {
  private gl: WebGL2RenderingContext; private program!: WebGLProgram; private textures: WebGLTexture[] = []; private buffer!: WebGLBuffer;
  constructor(private canvas: HTMLCanvasElement, stages: ColorGradeStage[]) {
    const gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true,antialias:false});
    if(!gl) throw new Error('This color effect requires WebGL 2 in browser preview. Use the native GPU monitor.'); this.gl=gl;
    const grade=colorGradeProgram(stages);
    try {
    if(grade.textures.some(({lut})=>lut.size*lut.size>gl.getParameter(gl.MAX_TEXTURE_SIZE)))throw new Error('This LUT exceeds the browser texture size. Use a smaller grid or the native GPU monitor.');
    const compile=(type:number,source:string)=>{const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(message||'Color shader compilation failed.');}return shader;};
    const vertex=compile(gl.VERTEX_SHADER,'#version 300 es\nin vec2 p;out vec2 uv;void main(){uv=vec2((p.x+1.0)*0.5,(1.0-p.y)*0.5);gl_Position=vec4(p,0,1);}');
    const fragment=compile(gl.FRAGMENT_SHADER,`#version 300 es\nprecision highp float;in vec2 uv;out vec4 outputColor;uniform sampler2D source;${grade.textures.map(({name})=>`uniform sampler2D ${name};vec4 ${name}_tex(vec2 p){return texture(${name},p);}`).join('\n')}\n${grade.functions.join('\n')}\nvoid main(){vec4 c=texture(source,uv);${grade.operations.join('\n')}outputColor=c;}`);
    this.program=gl.createProgram()!;gl.attachShader(this.program,vertex);gl.attachShader(this.program,fragment);gl.linkProgram(this.program);gl.deleteShader(vertex);gl.deleteShader(fragment);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program)||'Color shader link failed.');
    gl.useProgram(this.program); this.buffer=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const location=gl.getAttribLocation(this.program,'p');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
    for(let index=0;index<=grade.textures.length;index++) {
      const texture=gl.createTexture()!;this.textures.push(texture);gl.activeTexture(gl.TEXTURE0+index);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,index?gl.NEAREST:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,index?gl.NEAREST:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      const entry=grade.textures[index-1];gl.uniform1i(gl.getUniformLocation(this.program,entry?.name??'source'),index);
      if(entry) gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,entry.lut.size*entry.lut.size,entry.lut.size,0,gl.RGBA,gl.FLOAT,colorLutRgba(entry.lut));
    }
    } catch(error){this.dispose();throw error;}
  }
  draw(source: CanvasImageSource) {
    if(source instanceof SVGImageElement)throw new Error('Color media must provide a decoded image or video frame.');
    const width='videoWidth' in source?source.videoWidth:'naturalWidth' in source?source.naturalWidth:'displayWidth' in source?source.displayWidth:source.width;
    const height='videoHeight' in source?source.videoHeight:'naturalHeight' in source?source.naturalHeight:'displayHeight' in source?source.displayHeight:source.height;
    if(!width||!height)return;
    const gl=this.gl;if(gl.isContextLost())throw new Error('Color preview GPU context was lost. Reload the preview.');
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    gl.viewport(0,0,width,height);gl.useProgram(this.program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textures[0]);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.drawArrays(gl.TRIANGLES,0,6);gl.flush();
  }
  dispose(){for(const texture of this.textures)this.gl.deleteTexture(texture);if(this.buffer)this.gl.deleteBuffer(this.buffer);if(this.program)this.gl.deleteProgram(this.program);}
}
