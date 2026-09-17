function apiError(status,message,retryAfter) {const error=new Error(message);error.status=status;error.retryAfter=retryAfter;return error;}

export function createTtsApiClient({baseUrl,token,fetchImpl=fetch,timeoutMs=30000}) {
  if(!baseUrl||!token)throw new Error("TTS_API_URL and TTS_API_TOKEN are required");
  const endpoint=baseUrl.replace(/\/$/,"");
  const request=async(path,{method="GET",body,timeout=timeoutMs}={})=>{
    let response;
    try {response=await fetchImpl(`${endpoint}${path}`,{method,headers:{Authorization:`Bearer ${token}`,...(body?{"Content-Type":"application/json"}:{})},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});} catch(error) {error.transient=true;throw error;}
    if(!response.ok) {let detail="TTS API request failed";try {detail=(await response.json()).detail??detail;} catch {}throw apiError(response.status,detail,response.headers.get("retry-after"));}
    return response;
  };
  return {
    async profiles(){return (await (await request("/v1/profiles")).json()).profiles;},
    async create(value){return await (await request("/v1/jobs",{method:"POST",body:value})).json();},
    async get(id){return (await (await request(`/v1/jobs/${id}`)).json()).job;},
    async audio(id){const response=await request(`/v1/jobs/${id}/audio`,{timeout:300000}),limit=64*1024*1024;
      const announced=Number(response.headers.get("content-length")??0);if(announced&&(!Number.isSafeInteger(announced)||announced<1||announced>limit))throw apiError(413,"TTS audio is too large");
      if(!response.body)throw apiError(502,"TTS audio body is missing");const reader=response.body.getReader(),chunks=[];let size=0;
      try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw apiError(413,"TTS audio is too large");}chunks.push(Buffer.from(value));}}
      finally {reader.releaseLock();}return{bytes:Buffer.concat(chunks,size),sha256:response.headers.get("x-content-sha256")};},
    async ack(id,sha256){await request(`/v1/jobs/${id}/ack`,{method:"POST",body:{sha256}});},
  };
}
