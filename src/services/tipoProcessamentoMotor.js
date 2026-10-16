'use strict';

// Os dois tipos representam uma nova fotografia integral. A diferença é
// somente quem a solicitou; ambos precisam publicar e promover no Supabase.
const TIPOS_FOTOGRAFIA_COMPLETA=new Set(['MOTOR_COMPLETO','RECALCULO_INCREMENTAL']);
const exigePublicacaoFotografia=(tipo)=>TIPOS_FOTOGRAFIA_COMPLETA.has(String(tipo||''));

module.exports={TIPOS_FOTOGRAFIA_COMPLETA,exigePublicacaoFotografia};
