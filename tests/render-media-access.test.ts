import {expect,it} from 'vitest';
import {RenderMediaAccess} from '../server/services/render-media-access';
import {createDemo} from '../shared/demo';
it('authorizes only render-owned image paths on local renderer origins and revokes them after completion',()=>{
  const access=new RenderMediaAccess();const project=createDemo();project.assets=[{id:'image',name:'Image',kind:'image',src:'/project-media/project/media/image.png',duration:1,width:320,height:180}];
  const grant=access.prepare(project);const url=new URL(grant.project.assets[0].src,'http://127.0.0.1:4318');const token=url.searchParams.get('framecraft-render');
  expect(project.assets[0].src).not.toContain('?');expect(access.permits(url.pathname,token,'http://localhost:3000')).toBe(true);
  expect(access.permits('/api/project',token,'http://localhost:3000')).toBe(false);expect(access.permits(url.pathname,'wrong','http://localhost:3000')).toBe(false);
  expect(access.permits(url.pathname,token,'https://unrelated.example')).toBe(false);expect(access.permits(url.pathname,token,'null')).toBe(false);
  grant.release();expect(access.permits(url.pathname,token,'http://localhost:3000')).toBe(false);
});
