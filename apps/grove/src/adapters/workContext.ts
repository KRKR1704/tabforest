import { WorkContextItemInput, WorkContextResponse, TokenData } from '../types';
import { mockWorkContextResponse } from '../mocks/mockData';
import { isMockMode } from './grove';
import { sendBridgeMessage } from './bridge';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

async function getAuthHeader(): Promise<Record<string, string>> {
  const tokenRes = await sendBridgeMessage<void, TokenData>('GET_TOKEN');
  const token = tokenRes.data?.token;
  if (token) return { Authorization: `Bearer ${token}` };
  return { 'X-Dev-User': 'usr-5d0a-9b1e-3f4a' };
}

export async function analyzeWorkContext(
  projectName: string,
  items: WorkContextItemInput[]
): Promise<WorkContextResponse> {
  if (isMockMode()) {
    return {
      ...mockWorkContextResponse,
      project: projectName || mockWorkContextResponse.project,
    };
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/work-context/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        project_name: projectName,
        items,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[WorkContext Adapter] analyze failed, using mock fallback:', err);
    return mockWorkContextResponse;
  }
}

export async function uploadWorkContext(
  projectName: string,
  files: File[],
  items?: WorkContextItemInput[]
): Promise<WorkContextResponse> {
  if (isMockMode()) {
    return {
      ...mockWorkContextResponse,
      project: projectName || mockWorkContextResponse.project,
    };
  }

  try {
    const headers = await getAuthHeader();
    const formData = new FormData();
    formData.append('project_name', projectName);
    files.forEach((file) => formData.append('files[]', file));
    if (items && items.length > 0) {
      formData.append('items_json', JSON.stringify(items));
    }

    const res = await fetch(`${API_BASE_URL}/api/work-context/upload`, {
      method: 'POST',
      headers: {
        ...headers,
      },
      body: formData,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[WorkContext Adapter] upload failed, using mock fallback:', err);
    return mockWorkContextResponse;
  }
}
