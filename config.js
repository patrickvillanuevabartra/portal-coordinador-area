/* ==========================================================================
   Portal del Coordinador de Área — URP
   config.js — mapa de entidades y campos de QuintaDB
   --------------------------------------------------------------------------
   Todos los IDs salen de los JSON de estructura de cada tabla.
   Si agregas o renombras un campo en QuintaDB, actualiza solo este archivo.
   ========================================================================== */

window.PCA_CONFIG = {

  APP_ID: 'bxW5nYl8nlkOokW4JcMfb2',

  // URL del Worker. Cambiar por la definitiva al desplegar.
  PROXY: 'https://proxy-pca.patrick-villanueva.workers.dev',

  GOOGLE_CLIENT_ID: '1070423476628-j7qemmjemlm2eoi50f0k9iohp1gbprf3.apps.googleusercontent.com',
  DOMINIO: 'urp.edu.pe',

  CICLO_ACTIVO: '2026 II',

  // ---------------------------------------------------------------- lecturas
  FUENTES: {

    docentesDAI: {
      entity: 'c4vCoiswvcVOJdSIxcOSou',
      campos: {
        ciclo:        'ayWRVcUMvie4oer8ojWRjq',  // relación -> entidad Ciclo
        programa:     'dcGvSPB19fWQldGdj1tqiX',  // relación -> entidad Programa
        curso:        'cRfqnPWRPiW5u2o8o1ECoW',  // relación -> Cursos-Sumillas
        planEstudio:  'ddIG3cQ8jfb6TaBrPqDCoE',  // columna relacionada
        codigo:       'bLW4_cTWvcU6pdUSk1WO45',  // columna relacionada
        semestre:     'cooSkKW5DdO7dcSSoyCSor',  // columna relacionada
        grupo:        'ddLSoop0bdQ4owW7xcQMqB',
        subGrupo:     'cInq_cIMjdN4k7WQTLsIL1',
        area:         'dcNCkwWOzcTOkFWQZdIWv8',  // relación -> Área y coordinador
        docente:      'bIjSk0W7LiuilcQ8ksjSkd',
        correo:       'ddLblcTv1cLyobmb50WRup',
        celular:      'cRW63dMSnlW6bSW6RdGSou',
        idAsignacion: 'c1tWFcG35nAOz6yCo4pZq2'   // texto, escribible por REST
      }
    },

    areaCoordinador: {
      entity: 'cdmSkpWOvbWOexW7hdQ8oi',
      campos: {
        programa:     'cbmuH0gmnacyoNcCoXpmoe',
        curso:        'cgmSkVWQfpE4o1WP1Tt8kg',
        codigoCurso:  'dcQ8kDWQXcV6NdUCkDz8kf',
        semestre:     'akWQNcKCnbxyo2FepcOHD3',
        planEstudio:  'cUtCoaW7bgjikeasuECv9w',
        area:         'csELZdRmnnW4ZdK8oPW5P4',
        coordinador:  'bGW6BdNf1cPQZcPmkuD8k3',
        correo:       'bbbstcMJvfWQJcP8o_ngjU',
        celular:      'dcM3VdKmjlWPNdM8oAamoh',
        docente:      'dcO2pcHMPjjOkzW5ZcLCoF'
      }
    },

    cursosSumillas: {
      entity: 'cUW7TEuYXdH4oBW5SHW7Xs',
      campos: {
        programa:     'c6WRv3ywrcMiRcT8oqvmok',
        planEstudio:  'b1WQVdNq9dHikDusZdH8k1',
        codigo:       'ddKx7cRCjnjikIWRSKWPqj',
        curso:        'dcTmkTWOrivQNcKuK4ztiu',
        semestre:     'bqmve8WQbcQikzpCkGWQ0r',
        sumilla:      'atDSkuWPrnWRHpsLhdHmkB'
      }
    },

    ciclo:    { entity: 'b8WQNdKYLdS4f8WQKZtZC1' },
    programa: { entity: 'cwhIOQE8jgW4vHiCkFFmo3' }
  },

  // ------------------------------------------------------ módulos del portal
  MODULOS: {

    silabo: {
      nombre: 'Lista de verificación de sílabo',
      corto: 'Sílabo',
      entity: 'aFnXKxW4ncVltdQ8ogBSob',
      activo: true,
      comun: {
        idAsignacion: 'cpW5H1qWvcM6pdMSkQrmkJ',
        ciclo:        'cRWOnGFvPcTyo6xCkLoSoB',
        programa:     'chDmoIWQHcQikEWP7dMmof',
        area:         'cZWOuLW5vcGildL8oRfSoQ',
        codigo:       'cUWQxdR1vaaOoXW4hdMHS7',
        asignatura:   'a3WO3dGSjjoOlcP2zMWPuK',
        docente:      'c6hSodWOzozioLlmoRumoq',
        grupo:        'czWQu4WOzdHioNW7xdGg9O',
        coordinador:  'cgWQZdOIXcLykPW57cOISY'
      },
      campos: {
        planEstudio:      'a_WR1FhH5fe6qSkSoFWRap',
        revisor:          'ajW4ZcUmjbq6zeW4exWROV',
        fechaRevision:    'dcLSoJCKLnWR4IW51ul8kQ',
        itemsConformes:   'bGnZFcSKTiWPVcS8oGWQCh',
        porcentaje:       'aMjrDDWR1lo5mhhSkcq8oi',
        estado:           'b8W7rmvmnpvikJlCkgW45n',
        fechaLevantamiento:'c1tsNdUSncW6RcHc7dKCkQ',
        observaciones:    'dcOZ7dVmndWPVcJH80W700',
        enlace:           'avvWvsW71gyzRdNbm9eMvY'
      },
      items: [
        { n:'01', etiqueta:'Nombre, código, horas y créditos',      estado:'ddTCoEW75jWP8HWR0MW4SI', obs:'any1BdICnaqy57vZldH8o1' },
        { n:'02', etiqueta:'Sumilla según plan de estudios',        estado:'b0emkZW5zdBP_cHvW2W4C8', obs:'b9W4VdP0zdSQ7dPmomFSkV' },
        { n:'03', etiqueta:'Competencias genéricas',                estado:'bRW4OvCSjojjNcR1lcSeDn', obs:'a8cmo6W6bkBOo_W656rmku' },
        { n:'04', etiqueta:'Competencias específicas',              estado:'ahBSoDW5PaW5RcLJFcL8o5', obs:'cpWRrUW41dUioqwSkrWPOp' },
        { n:'05', etiqueta:'Componentes (investigación formativa)', estado:'cTlW5cjSnbh4oVW6ZcR8oc', obs:'bXW5mpW6PcQOq9W6jUASoB' },
        { n:'06', etiqueta:'Logro de la asignatura',                estado:'cPW5CfW5niW6NdPb5bESo3', obs:'afFmkLtmjgWP5HBrpdTmo9' },
        { n:'07', etiqueta:'Unidades (4, según formato)',           estado:'bArmk9W6vdKOoDdx7cGSk7', obs:'ddVWxcK8nfW6pcHCkZpLmA' },
        { n:'08', etiqueta:'Estrategias didácticas',                estado:'ddJmkOAmjjf4kWw8keah4d', obs:'ceWQNcIsDcAOkrErpdU8kz' },
        { n:'09', etiqueta:'Recursos',                              estado:'dcKvpdVdvbfA9OoghdICkF', obs:'ansvLtm05cRzdcRSoAp8o-' },
        { n:'10', etiqueta:'Fórmula de evaluación',                 estado:'ddUbubWQXcH5T6f8otiCoX', obs:'aii8kjtNfcTQS1v8kgW6a7' },
        { n:'11', etiqueta:'Referencias bibliográficas APA',        estado:'cTW7pdSCjhw7_dISkKWOGI', obs:'ahWQaHCmnpWQ7cKJVdQ8kq' }
      ]
    },

    entrevistas: {
      nombre: 'Entrevistas con delegados',
      corto: 'Entrevistas',
      entity: 'cXWR7cP8niWPZcKmovW4Pw',
      activo: false,
      comun: {
        idAsignacion: 'cWqSoxW4nlWRCGWRTDjSkm',
        ciclo:        'cxW55LvmjiwioDsSkawc1G',
        programa:     'ddL8otW6ndM7lcJ8kAWOyj',
        area:         'cwC3rlcmjmW7NdHCoYEqT2',
        codigo:       'ddVZtcGmjkWOXOW63dRCkd',
        asignatura:   'ddJSorvSndWRCpW7hdNXaj',
        docente:      'ddU8kCWOTbelP2W4rRyGn-',
        grupo:        'bRWRBdPLXdO4k8gmkzWQ0y',
        coordinador:  'cse8kAr8jaWRC7umk8W4Cg'
      },
      campos: {
        fechaHora:    'aOWQKRtCnoW6xcQCkmBZ91',
        modalidad:    'cIbchcG8jbW6efE8oZW6v6',
        delegado:     'dcOHXCi19oW61NWPmMjmkG',
        subdelegado:  'bKxaVcK2PkWOBcKMRdQSkM',
        compromisos:  'ddI8oPlYTdVyD4W53dNmo3',
        alerta:       'cnW51lp0TcG5u2zSkElSoi',
        enlace:       'cGcCksW4fcNOoyW4pdSCov'
      },
      temas: [
        { etiqueta:'Prerrequisitos',                 id:'ddJHBdHCjdW5FdUCkmW7Ot' },
        { etiqueta:'Cumplimiento del sílabo',        id:'ddLmobW6rnu4NcPtH_WRmz' },
        { etiqueta:'Horas asignadas al curso',       id:'bhyCkfWOPnW4FcJdy6aCoO' },
        { etiqueta:'Experiencias de laboratorio',    id:'ddNYbwzf1cGlldQh3dOCoq' },
        { etiqueta:'Puntualidad',                    id:'cciJTry3roWO_cIsFcGJXU' },
        { etiqueta:'Retroalimentación al estudiante',id:'dcUtBdVSngWPldQSkKWOa0' },
        { etiqueta:'Bibliografía',                   id:'byWQydbSjjWRtcJmkDE8o_' },
        { etiqueta:'Comentarios de los estudiantes', id:'aarCoNAmjooOWPD8kZWQTt' }
      ]
    },

    formularios: {
      nombre: 'Cumplimiento F1, F2 y F3',
      corto: 'F1-F3',
      entity: 'ddN8k2u8jiW502WR7cSeeY',
      activo: false,
      comun: {
        idAsignacion: 'ddHXeDeCnaW55kWQNdP8kC',
        ciclo:        'cPW6aWrCjjaPldGJBcLSoz',
        programa:     'bSeI5nAJPcGQRcVeBdLCoq',
        area:         'c4nCkyArTdUyobW61dW4nr',
        codigo:       'ddLH49CSjjtikexmoEW4j1',
        asignatura:   'ddHfNdK1znEjJdSaddJSoz',
        docente:      'bzW5DJvebpaiVdOYldH8kd',
        grupo:        'aPEZfCpSjhW57cUmk9duCy',
        coordinador:  'ddSq3cNNTdTyoirKyrsSkH'
      },
      campos: {
        fechaRevision:'ckWQmkdbPhWRJdUCktxr5r',
        f1:           'ddJCoBBSjjW4FdGbdcVNm7',
        fechaF1:      'caWOyGW5bkWR7dG8kxk8o-',
        f2:           'dcOSk1smjiWQeKcCojiSob',
        fechaF2:      'cYWQdcVCnmW4S6W6SAwX1Z',
        f3:           'cxnCk5W7Hne57cJ3vJqCoc',
        fechaF3:      'aqWPNdJbLdSi_dNd7cS1KR',
        presentados:  'ddNCkNWRPeFAxdLmkbumof',
        observaciones:'cGqbBdL8jhu4oJcSkTeSkB'
      }
    },

    aulaVirtual: {
      nombre: 'Supervisión de aula virtual',
      corto: 'Aula virtual',
      entity: 'aQEMpcL8jhW5FcH2NcHfjd',
      activo: false,
      comun: {
        idAsignacion: 'cIWPNcHCngwju8WPpdLmov',
        ciclo:        'dcR8oVW5vdOjpcGmoYWPHs',
        programa:     'dcNchdGSjlWOShhSolWObA',
        area:         'clW5mfW69dMykAlmokCCkh',
        codigo:       'cDrWZdTmjkW7_cTIFcRtGv',
        asignatura:   'aXpSkTW49kWPOaguCytbKS',
        docente:      'ctf8kOW4jcNykex8kIsCo0',
        grupo:        'ddT8kKyCjhWPZdSmkkW418',
        coordinador:  'dcMCk5emnmc5DvwWHzihzx'
      },
      campos: {
        fechaSupervision:'cYW61UjSjeC4oxsqNdMSk_',
        responsable:     'cZWPFcRd9dIBpcUSokWPqR',
        cumplidos:       'cGWOBcSCncuOoHevPNW6m3',
        porcentaje:      'cgDSoaxCjnel4ovmoRamoi',
        observaciones:   'ddQmolWQjdIA3cTmkCgmoy',
        enlace:          'cgW77dTmjax7KKB2jmv8ko'
      },
      criterios: [
        { etiqueta:'Sílabo',                          id:'cNW7pdHHriW7NcSCkJWO0-' },
        { etiqueta:'Mensaje de sensibilización',      id:'amWPzIpevgvPpcSSkkWRW2' },
        { etiqueta:'Sesión de aprendizaje',           id:'cGWOlcRCjbW57cImkAFmod' },
        { etiqueta:'Rúbrica',                         id:'dcRMpcVHjdOyoEfmkHESk0' },
        { etiqueta:'Materiales',                      id:'aOWPbklLrcJ4kFlCoCcmku' },
        { etiqueta:'Actividades y tareas',            id:'cgActcJIDcQyorhCk9x8od' },
        { etiqueta:'Materiales adicionales',          id:'b8jmoGW75cKikCw3ldQmkf' },
        { etiqueta:'Links y grabaciones de sesiones', id:'ddOmoAedLmWRJcJSolg8k_' }
      ]
    },

    portafolios: {
      nombre: 'Supervisión de portafolios digitales',
      corto: 'Portafolios',
      entity: 'csymoIuanmW6jQW47dTYGp',
      activo: false,
      comun: {
        idAsignacion: 'bAW6joyKjcx5nsWQNcQCkF',
        ciclo:        'ddVCo0WOTdK4o7WQ7cICo2',
        programa:     'cKW5tdKCnlW7RcICowWPif',
        area:         'cbW69sxWrdR4oHW6xdR8kH',
        codigo:       'cGasKlfxvcPik6v8kAlSkv',
        asignatura:   'buWO0Fih1dIzhcLSkoDmoL',
        docente:      'cQus3dTdzaW5xdK8o9W59e',
        grupo:        'dcOsxdNwvgW6VcM8oSW6uZ',
        coordinador:  'abCJFcGefmCj7dThiJWOrS'
      },
      campos: {
        fechaSupervision:'c-WQZcISjhFiJdGCo9ymor',
        responsable:     'cNbmonWObiliFdJCopW41I',
        cumplidas:       'axbmoRWO9cURiDvfuEW716',
        porcentaje:      'dcOvxcTMDeWQDeWOFdLSkN',
        observaciones:   'cnW4_dImjajOo_W689WRrp',
        enlace:          'b6Amo2WQTjWOBdIe7dVrT8'
      },
      criterios: [
        { etiqueta:'Prueba de entrada',      id:'aCW5PhhmnkW4XNW4JcK1Ox' },
        { etiqueta:'Prácticas',              id:'ddLCkKW41lWQGVW6lcKSoe' },
        { etiqueta:'Laboratorio y talleres', id:'aPWQxcHmnmWReXxJRdJ8ok' },
        { etiqueta:'Investigación',          id:'cDySkpW4bcUOkqfCkBW78w' },
        { etiqueta:'Proyectos',              id:'dcVeGZwCnnyjtdTmk0WOGn' },
        { etiqueta:'Trabajos y tareas',      id:'dcKCkTvvfoc6tdK8o_t8kr' },
        { etiqueta:'Exámenes',               id:'dcO8oJWPrcWRlcMLFcU8on' }
      ]
    },

    delegados: {
      nombre: 'Datos de delegados',
      corto: 'Delegados',
      entity: 'cgW4VdL3jcSikyW7VcVmk_',
      activo: false,
      comun: {
        idAsignacion: 'ddMSoNf8nlF7q1rSkjaCoe',
        ciclo:        'c3o1G1tNDdJlPrWO0XW59x',
        programa:     'bRAmkaW4TiWO4zycHbmCow',
        area:         'afW7WTW4Ppm4kcW7nBm8k3',
        codigo:       'aJsSoDW7DnW7VdJSoqaSkQ',
        asignatura:   'ddHZ8WW41dUOoMW4W1rN9I',
        docente:      'aKWPNdSCjjWPZdQIldOfn5',
        grupo:        'a5aIFcHujdJykFW4tdK8o4',
        coordinador:  'ddH8o_WP1dEyoeo8oRE3er'
      },
      campos: {
        codigoDelegado:      'c9vSkxxmnnW49sW5aGW4qH',
        delegado:            'bzrsbMWQfjEOkEWO8GuSoE',
        correoDelegado:      'c7WO3cMfrdJjRdU8oXWPqF',
        celularDelegado:     'ddQ3rsWOzcT4oVpfRdQSo4',
        fijoDelegado:        'amWPHNjM5dMOWtW5PmtCoQ',
        codigoSubdelegado:   'c5rveYoSnpb4kCWPacxmkq',
        subdelegado:         'bkgCo9W4XdSyk3gwBcR8oy',
        correoSubdelegado:   'ddLrdcH8jifPeOWRm5w1eM',
        celularSubdelegado:  'b1WOinwSjpqyoKEg4eW5aL',
        fijoSubdelegado:     'aWzuZdTmnhW7VcTH0RzXa2',
        estado:              'dcJs01W7XdIktdS8khiSoi',
        observaciones:       'byW40WW4bfW40dW7bOArzY'
      }
    }
  },

  // ------------------------------------------------------------------ listas
  ESCALA: ['Cumple', 'Parcial', 'No cumple', 'No aplica'],
  ESTADOS_SILABO: ['Conforme', 'Observado', 'Levantado'],

  // Valor que QuintaDB guarda cuando nadie eligió en un desplegable.
  VACIO: 'Seleccione'
};
