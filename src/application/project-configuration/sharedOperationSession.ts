let version=0;
export const currentSharedOperationSession=()=>version;
export const invalidateSharedOperationSession=()=>{version++;};
