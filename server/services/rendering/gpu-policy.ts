/** Applies to the editor and its export workers; hardware tests opt in separately. */
export const gpuDisabled = () => process.env.FRAMECRAFT_DISABLE_GPU === '1';
