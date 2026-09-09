import type {ProjectAction, ProjectCatalog} from '../../shared/project-library';
import type {Snapshot} from '../../shared/project';
import {request} from './editor-api';
export const projectApi = {
  list: () => request<ProjectCatalog>('/api/projects'),
  manage: (action: ProjectAction) => request<Snapshot>('/api/projects', action),
};
