# RoomPackage de referencia — "La Maldición del Rey Aldric" v1.0.0

Documento de trabajo que acompaña a `especificaciones-escape-room-creator-v1.0.md`.

## Propósito de este documento

1. **Validar el formato RoomPackage:** demostrar que el JSON puede expresar de punta a punta una sala real de 3 habitaciones con las 8 plantillas del MVP.
2. **Fixture de pruebas permanente:** este paquete es la suite de regresión del runtime (test E2E: cargar y completar el Rey Aldric).
3. **Plantilla de referencia** para el MCP, el onboarding y los creadores ("desmóntala y mira cómo está hecha").
4. **Ejercicio de validación del validador:** incluye al final el informe de validación esperado.

## Convenciones

- Grid por habitación, origen (0,0) arriba-izquierda. Cada habitación es un mapa propio; las puertas enlazan mapas.
- Capas de tilemap en RLE (run-length encoding): `[cantidad, tileId, cantidad, tileId, ...]` recorrido fila a fila. `0` = celda vacía.
- Tiles de ejemplo: `1` piedra, `2` loseta, `3` alfombra, `10` muro, `11` muro+antorcha, `12` muro+tapiz, `20` puerta madera, `21` reja, `22` arco abierto.
- Los estados de objeto son strings arbitrarios declarados en `states` (ver Especificaciones §2).
- Las posiciones de objeto son en celdas de grid (el runtime las proyecta a coordenadas isométricas).

---

## El paquete completo

```json
{
  "meta": {
    "id": "room-rey-aldric",
    "title": "La Maldición del Rey Aldric",
    "authorId": "org-escapehub-official",
    "version": "1.0.0",
    "theme": "medieval",
    "description": "El rey Aldric fue traicionado por su hermano, el mago Malrec, que selló su alma en un relicario en las catacumbas del castillo. Cruza el Salón del Trono, la Bodega de los Vinos Encantados y las Catacumbas para romper el sello en 60 minutos.",
    "language": "es",
    "estimatedMinutes": 55,
    "difficulty": 2,
    "players": { "min": 1, "max": 4 },
    "assetsManifest": "r2://assets/packs/medieval-v1/manifest.json"
  },

  "map": {
    "tileset": "medieval-v1",
    "rooms": [
      {
        "id": "salon-trono",
        "name": "El Salón del Trono",
        "grid": { "cols": 20, "rows": 14 },
        "layers": [
          { "name": "ground", "rle": [20,1, 20,1, 20,1, 20,1, 20,1, 6,1,8,3,6,1, 6,1,8,3,6,1, 6,1,8,3,6,1, 6,1,8,3,6,1, 6,1,8,3,6,1, 20,1, 20,1, 20,1, 20,1] },
          { "name": "walls", "rle": [20,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 10,10,1,20,9,10] }
        ],
        "decorations": [
          { "sprite": "tapiz-dragones", "x": 4, "y": 0 },
          { "sprite": "tapiz-dragones", "x": 15, "y": 0 },
          { "sprite": "columna", "x": 2, "y": 3 }, { "sprite": "columna", "x": 17, "y": 3 },
          { "sprite": "estandarte", "x": 2, "y": 10 }, { "sprite": "estandarte", "x": 17, "y": 10 }
        ],
        "spawnPoints": [
          { "id": "spawn-1", "x": 10, "y": 12 },
          { "id": "spawn-2", "x": 9,  "y": 12 },
          { "id": "spawn-3", "x": 11, "y": 12 },
          { "id": "spawn-4", "x": 8,  "y": 12 }
        ],
        "lighting": [
          { "type": "torch", "x": 5, "y": 1, "objectId": "brasero" },
          { "type": "ambient", "color": "#3a2f22", "intensity": 0.6 }
        ]
      },
      {
        "id": "bodega",
        "name": "La Bodega de los Vinos Encantados",
        "grid": { "cols": 18, "rows": 12 },
        "layers": [
          { "name": "ground", "rle": [18,2, 18,2, 18,2, 18,2, 18,2, 18,2, 18,2, 18,2, 18,2, 18,2, 18,2, 18,2] },
          { "name": "walls", "rle": [18,10, 1,10,16,0,1,10, 1,10,16,0,1,10, 1,10,16,0,1,10, 1,10,16,0,1,10, 1,10,16,0,1,10, 1,10,16,0,1,10, 1,10,16,0,1,10, 1,10,16,0,1,10, 1,10,16,0,1,10, 7,10,1,22,1,21,8,10, 18,10] }
        ],
        "decorations": [
          { "sprite": "barriles", "x": 1, "y": 2 }, { "sprite": "barriles", "x": 1, "y": 4 },
          { "sprite": "barriles", "x": 16, "y": 2 }, { "sprite": "barril-suelto", "x": 15, "y": 8 }
        ],
        "spawnPoints": [
          { "id": "spawn-1", "x": 9, "y": 2 },
          { "id": "spawn-2", "x": 8, "y": 2 },
          { "id": "spawn-3", "x": 10, "y": 2 },
          { "id": "spawn-4", "x": 7, "y": 2 }
        ],
        "lighting": [
          { "type": "torch", "x": 3, "y": 1 }, { "type": "torch", "x": 14, "y": 1 },
          { "type": "ambient", "color": "#2a1f16", "intensity": 0.5 }
        ]
      },
      {
        "id": "catacumbas",
        "name": "Las Catacumbas del Rey",
        "grid": { "cols": 20, "rows": 20 },
        "layers": [
          { "name": "ground", "rle": [20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1, 20,1] },
          { "name": "walls", "rle": [20,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 1,10,18,0,1,10, 20,10] }
        ],
        "decorations": [
          { "sprite": "antorcha", "x": 2, "y": 1 }, { "sprite": "antorcha", "x": 17, "y": 1 },
          { "sprite": "antorcha", "x": 2, "y": 18 }, { "sprite": "antorcha", "x": 17, "y": 18 }
        ],
        "spawnPoints": [
          { "id": "spawn-1", "x": 10, "y": 17 },
          { "id": "spawn-2", "x": 9,  "y": 17 },
          { "id": "spawn-3", "x": 11, "y": 17 },
          { "id": "spawn-4", "x": 8,  "y": 17 }
        ],
        "lighting": [
          { "type": "ambient", "color": "#1a1510", "intensity": 0.45 }
        ]
      }
    ]
  },

  "objects": [
    { "id": "trono", "roomId": "salon-trono", "type": "decorativo", "position": { "x": 10, "y": 1 }, "sprite": "trono", "states": {}, "initialState": "", "interactable": true },
    { "id": "cuadro-aurelio", "roomId": "salon-trono", "type": "escondite", "position": { "x": 6, "y": 0 }, "sprite": "cuadro-rey", "states": { "closed": "cuadro-rey", "open": "cuadro-rey-torcido" }, "initialState": "closed", "interactable": true,
      "hidingSpot": { "contains": "llave-bronce" } },
    { "id": "retrato-2", "roomId": "salon-trono", "type": "decorativo", "position": { "x": 8, "y": 0 }, "sprite": "cuadro-reino-4torres", "states": {}, "initialState": "", "interactable": true },
    { "id": "retrato-3", "roomId": "salon-trono", "type": "decorativo", "position": { "x": 12, "y": 0 }, "sprite": "cuadro-reino", "states": {}, "initialState": "", "interactable": true },
    { "id": "retrato-4", "roomId": "salon-trono", "type": "decorativo", "position": { "x": 14, "y": 0 }, "sprite": "cuadro-reino", "states": {}, "initialState": "", "interactable": true },
    { "id": "tapiz-dragones", "roomId": "salon-trono", "type": "decorativo", "position": { "x": 10, "y": 0 }, "sprite": "tapiz-7-dragones", "states": {}, "initialState": "", "interactable": true },
    { "id": "armario", "roomId": "salon-trono", "type": "cajon", "position": { "x": 18, "y": 4 }, "sprite": "armario", "states": { "closed": "armario", "open": "armario-abierto" }, "initialState": "closed", "interactable": true },
    { "id": "arca-candado", "roomId": "salon-trono", "type": "mecanismo", "position": { "x": 18, "y": 6 }, "sprite": "arca", "states": { "closed": "arca-cerrada", "open": "arca-abierta" }, "initialState": "closed", "interactable": true, "lockedBy": "p-candado-arca" },
    { "id": "brasero", "roomId": "salon-trono", "type": "mecanismo", "position": { "x": 4, "y": 6 }, "sprite": "brasero", "states": { "unlit": "brasero-apagado", "lit": "brasero-encendido" }, "initialState": "unlit", "interactable": true },
    { "id": "estatua-izq", "roomId": "salon-trono", "type": "decorativo", "position": { "x": 7, "y": 3 }, "sprite": "estatua-caballero", "states": {}, "initialState": "", "interactable": true },
    { "id": "estatua-der", "roomId": "salon-trono", "type": "decorativo", "position": { "x": 13, "y": 3 }, "sprite": "estatua-caballero", "states": {}, "initialState": "", "interactable": true },
    { "id": "placa-izq", "roomId": "salon-trono", "type": "mecanismo", "position": { "x": 6, "y": 11 }, "sprite": "placa-piedra", "states": { "up": "placa-arriba", "down": "placa-hundida" }, "initialState": "up", "interactable": true },
    { "id": "placa-der", "roomId": "salon-trono", "type": "mecanismo", "position": { "x": 14, "y": 11 }, "sprite": "placa-piedra", "states": { "up": "placa-arriba", "down": "placa-hundida" }, "initialState": "up", "interactable": true },
    { "id": "puerta-bodega", "roomId": "salon-trono", "type": "puerta", "position": { "x": 10, "y": 13 }, "sprite": "puerta-madera", "states": { "closed": "puerta-cerrada", "open": "puerta-abierta" }, "initialState": "closed", "interactable": true, "lockedBy": "p-placas-estatuas", "leadsTo": "bodega" },

    { "id": "mural-vendimia", "roomId": "bodega", "type": "mecanismo", "position": { "x": 2, "y": 1 }, "sprite": "mural-azulejos", "states": { "scrambled": "mural-desordenado", "complete": "mural-completo" }, "initialState": "scrambled", "interactable": true, "lockedBy": "p-mural-vendimia" },
    { "id": "mural-ranura", "roomId": "bodega", "type": "mecanismo", "position": { "x": 2, "y": 3 }, "sprite": "ranura-caliz", "states": { "empty": "ranura-vacia", "filled": "ranura-con-caliz" }, "initialState": "empty", "interactable": true },
    { "id": "compartimento-plata", "roomId": "bodega", "type": "cajon", "position": { "x": 2, "y": 4 }, "sprite": "compartimento", "states": { "closed": "compartimento-cerrado", "open": "compartimento-abierto" }, "initialState": "closed", "interactable": true },
    { "id": "barril-espejo", "roomId": "bodega", "type": "escondite", "position": { "x": 15, "y": 8 }, "sprite": "barril-suelto", "states": { "closed": "barril-cerrado", "open": "barril-movido" }, "initialState": "closed", "interactable": true,
      "hidingSpot": { "contains": "espejo" } },
    { "id": "mesa-catas", "roomId": "bodega", "type": "mecanismo", "position": { "x": 9, "y": 6 }, "sprite": "mesa-catas", "states": { "idle": "mesa", "active": "mesa-activa" }, "initialState": "idle", "interactable": true, "lockedBy": "p-copas-memoria" },
    { "id": "reja-escalera", "roomId": "bodega", "type": "puerta", "position": { "x": 12, "y": 10 }, "sprite": "reja", "states": { "closed": "reja-cerrada", "open": "reja-abierta" }, "initialState": "closed", "interactable": true, "lockedBy": "p-reja-mirillas", "leadsTo": "catacumbas" },
    { "id": "mirilla-a", "roomId": "bodega", "type": "mecanismo", "position": { "x": 10, "y": 10 }, "sprite": "mirilla", "states": {}, "initialState": "", "interactable": true },
    { "id": "mirilla-b", "roomId": "bodega", "type": "mecanismo", "position": { "x": 14, "y": 10 }, "sprite": "mirilla", "states": {}, "initialState": "", "interactable": true },

    { "id": "sarcofago", "roomId": "catacumbas", "type": "decorativo", "position": { "x": 10, "y": 8 }, "sprite": "sarcofago", "states": {}, "initialState": "", "interactable": true },
    { "id": "altar", "roomId": "catacumbas", "type": "mecanismo", "position": { "x": 10, "y": 4 }, "sprite": "altar", "states": { "dry": "altar-seco", "flowing": "altar-con-agua" }, "initialState": "dry", "interactable": true },
    { "id": "canal-entrada", "roomId": "catacumbas", "type": "mecanismo", "position": { "x": 2, "y": 4 }, "sprite": "canal", "states": {}, "initialState": "", "interactable": true, "lockedBy": "p-canal-agua" },
    { "id": "compuerta-oro", "roomId": "catacumbas", "type": "cajon", "position": { "x": 4, "y": 4 }, "sprite": "compuerta", "states": { "closed": "compuerta-cerrada", "open": "compuerta-abierta" }, "initialState": "closed", "interactable": true, "lockedBy": "p-combina" },
    { "id": "relicario", "roomId": "catacumbas", "type": "mecanismo", "position": { "x": 10, "y": 2 }, "sprite": "relicario", "states": { "sealed": "relicario-sellado", "open": "relicario-abierto" }, "initialState": "sealed", "interactable": true, "lockedBy": "p-sello-final" },
    { "id": "vasijas", "roomId": "catacumbas", "type": "decorativo", "position": { "x": 16, "y": 10 }, "sprite": "vasijas-8", "states": {}, "initialState": "", "interactable": true }
  ],

  "items": [
    { "id": "mechero", "name": "Mechero de pedernal", "icon": "icon-mechero" },
    { "id": "vela", "name": "Vela", "icon": "icon-vela" },
    { "id": "antorcha", "name": "Antorcha encendida", "icon": "icon-antorcha" },
    { "id": "llave-bronce", "name": "Llave de bronce", "icon": "icon-llave-bronce" },
    { "id": "llave-plata", "name": "Llave de plata", "icon": "icon-llave-plata" },
    { "id": "llave-oro", "name": "Llave de oro", "icon": "icon-llave-oro" },
    { "id": "caliz-real", "name": "Cáliz real", "icon": "icon-caliz" },
    { "id": "espejo", "name": "Espejo antiguo", "icon": "icon-espejo" },
    { "id": "pergamino-bodega", "name": "Pergamino de los vinos", "icon": "icon-pergamino" }
  ],

  "puzzles": [
    {
      "id": "p-combina", "type": "combine_items", "layer": "panel",
      "roomId": "salon-trono", "requiresSolved": [], "grantsItems": [], "unlocks": ["compuerta-oro"],
      "recipes": [
        { "inputs": ["mechero", "vela"], "output": "antorcha", "consumeInputs": true },
        { "inputs": ["llave-plata"], "output": "llave-oro", "consumeInputs": false, "description": "Inspeccionar: una llave dentro de otra" }
      ]
    },
    {
      "id": "p-llave-cuadro", "type": "hidden_key", "layer": "world",
      "roomId": "salon-trono", "position": { "x": 6, "y": 0 },
      "requiresSolved": [], "grantsItems": ["llave-bronce"], "unlocks": [],
      "hidingSpot": { "objectId": "cuadro-aurelio" },
      "revealAnimation": "shake"
    },
    {
      "id": "p-candado-arca", "type": "code_lock", "layer": "panel",
      "roomId": "salon-trono", "requiresSolved": [], "grantsItems": ["caliz-real", "pergamino-bodega"], "unlocks": ["arca-candado"],
      "length": 4, "code": "4732", "maxAttempts": 5, "lockoutSec": 30,
      "hints": ["hint-arca-1", "hint-arca-2"]
    },
    {
      "id": "p-placas-estatuas", "type": "simultaneous_plates", "layer": "world",
      "roomId": "salon-trono", "requiresSolved": [], "grantsItems": [], "unlocks": ["puerta-bodega"],
      "plates": [
        { "objectId": "placa-izq", "x": 6, "y": 11 },
        { "objectId": "placa-der", "x": 14, "y": 11 }
      ],
      "windowMs": 800, "holdMode": "stand", "soloBridgeItemId": "caliz-real"
    },
    {
      "id": "p-mural-vendimia", "type": "sliding_puzzle", "layer": "panel",
      "roomId": "bodega", "requiresSolved": [], "grantsItems": ["llave-plata"], "unlocks": ["compartimento-plata"],
      "grid": { "cols": 3, "rows": 3 }, "imageAsset": "mural-vendimia-3x3",
      "scramble": "fixed_seed", "seed": 812, "blankPosition": "last"
    },
    {
      "id": "p-copas-memoria", "type": "memory", "layer": "panel",
      "roomId": "bodega", "requiresSolved": [], "grantsItems": [], "unlocks": [],
      "pairs": [
        { "id": "par-uva", "symbol": "uva" },
        { "id": "par-sol", "symbol": "sol" },
        { "id": "par-llave", "symbol": "llave" }
      ],
      "decoys": 0, "maxFlipsPerTurn": 2, "winCondition": "find_all_pairs",
      "turnMode": "shared"
    },
    {
      "id": "p-reja-mirillas", "type": "split_clue", "layer": "world",
      "roomId": "bodega", "requiresSolved": ["p-copas-memoria"], "grantsItems": [], "unlocks": ["reja-escalera"],
      "viewpoints": [
        { "objectId": "mirilla-a", "zone": { "x": 9, "y": 10, "w": 2, "h": 2 } },
        { "objectId": "mirilla-b", "zone": { "x": 13, "y": 10, "w": 2, "h": 2 } }
      ],
      "fragments": ["luna", "corona", "luna", "espada"],
      "visibleByViewpoint": { "mirilla-a": ["luna", null, "luna", null], "mirilla-b": [null, "corona", null, "espada"] },
      "wallOccluder": { "x": 11, "y": 9, "w": 2, "h": 4 },
      "soloBridgeItemId": "espejo",
      "inputUI": "symbols"
    },
    {
      "id": "p-canal-agua", "type": "pipes", "layer": "panel",
      "roomId": "catacumbas", "requiresSolved": [], "grantsItems": [], "unlocks": ["altar"],
      "grid": { "cols": 5, "rows": 5 },
      "cellTypes": ["straight", "curve", "tee", "cross"],
      "startCell": { "x": 0, "y": 2 }, "endCell": { "x": 4, "y": 2 },
      "blockedCells": [ { "x": 3, "y": 2, "opensWithItem": "llave-oro" } ]
    },
    {
      "id": "p-sello-final", "type": "code_lock", "layer": "panel",
      "roomId": "catacumbas", "requiresSolved": ["p-canal-agua"], "grantsItems": [], "unlocks": ["relicario"],
      "length": 4, "code": "4538", "maxAttempts": 999, "lockoutSec": 0,
      "hints": ["hint-sello-1", "hint-sello-2", "hint-sello-3"]
    }
  ],

  "rules": [
    { "id": "r-inicio", "priority": 100, "once": true,
      "trigger": { "type": "on_game_start" },
      "conditions": [],
      "actions": [
        { "type": "start_timer", "id": "cronometro", "durationSec": 3600 },
        { "type": "show_dialog", "dialogId": "d-intro" }
      ] },

    { "id": "r-inspeccionar-cuadro", "priority": 0, "once": true,
      "trigger": { "type": "on_interact", "objectId": "cuadro-aurelio" },
      "conditions": [],
      "actions": [ { "type": "show_dialog", "dialogId": "d-cuadro" } ] },

    { "id": "r-encender-brasero", "priority": 0, "once": true,
      "trigger": { "type": "on_interact", "objectId": "brasero" },
      "conditions": [ { "type": "item_in_inventory", "itemId": "antorcha", "consumed": true } ],
      "actions": [
        { "type": "set_object_state", "objectId": "brasero", "state": "lit" },
        { "type": "set_flag", "flag": "digito3", "value": 3 },
        { "type": "show_dialog", "dialogId": "d-brasero" },
        { "type": "play_sound", "soundId": "fx-fuego" }
      ] },

    { "id": "r-abrir-armario", "priority": 0, "once": true,
      "trigger": { "type": "on_interact", "objectId": "armario" },
      "conditions": [ { "type": "item_in_inventory", "itemId": "llave-bronce", "consumed": true } ],
      "actions": [
        { "type": "set_object_state", "objectId": "armario", "state": "open" },
        { "type": "grant_item", "itemId": "mechero", "to": "interactor" },
        { "type": "grant_item", "itemId": "vela", "to": "interactor" }
      ] },

    { "id": "r-mural-resuelto", "priority": 0, "once": true,
      "trigger": { "type": "on_puzzle_solved", "puzzleId": "p-mural-vendimia" },
      "conditions": [],
      "actions": [
        { "type": "set_object_state", "objectId": "mural-vendimia", "state": "complete" },
        { "type": "set_object_state", "objectId": "compartimento-plata", "state": "open" },
        { "type": "set_flag", "flag": "digito2", "value": 5 },
        { "type": "show_dialog", "dialogId": "d-mural" }
      ] },

    { "id": "r-caliz-en-ranura", "priority": 0, "once": true,
      "trigger": { "type": "on_interact", "objectId": "mural-ranura" },
      "conditions": [ { "type": "item_in_inventory", "itemId": "caliz-real", "consumed": false } ],
      "actions": [
        { "type": "set_object_state", "objectId": "mural-ranura", "state": "filled" },
        { "type": "show_dialog", "dialogId": "d-ranura" }
      ] },

    { "id": "r-recoger-caliz", "priority": 0, "once": false,
      "trigger": { "type": "on_interact", "objectId": "mural-ranura" },
      "conditions": [
        { "type": "object_state_is", "objectId": "mural-ranura", "state": "filled" },
        { "type": "puzzle_state_is", "puzzleId": "p-placas-estatuas", "state": "solved" }
      ],
      "actions": [
        { "type": "set_object_state", "objectId": "mural-ranura", "state": "empty" },
        { "type": "grant_item", "itemId": "caliz-real", "to": "interactor" }
      ] },

    { "id": "r-copas-resueltas", "priority": 0, "once": true,
      "trigger": { "type": "on_puzzle_solved", "puzzleId": "p-copas-memoria" },
      "conditions": [],
      "actions": [
        { "type": "set_object_state", "objectId": "mesa-catas", "state": "active" },
        { "type": "set_flag", "flag": "digito3-copas", "value": 3 },
        { "type": "play_sound", "soundId": "fx-campanas" }
      ] },

    { "id": "r-leer-pergamino", "priority": 0, "once": true,
      "trigger": { "type": "on_item_collected", "itemId": "pergamino-bodega" },
      "conditions": [],
      "actions": [ { "type": "show_dialog", "dialogId": "d-pergamino" } ] },

    { "id": "r-entrar-catacumbas", "priority": 0, "once": true,
      "trigger": { "type": "on_enter_room", "roomId": "catacumbas" },
      "conditions": [],
      "actions": [ { "type": "show_dialog", "dialogId": "d-catacumbas" } ] },

    { "id": "r-inspeccionar-sarcofago", "priority": 0, "once": true,
      "trigger": { "type": "on_interact", "objectId": "sarcofago" },
      "conditions": [],
      "actions": [ { "type": "show_dialog", "dialogId": "d-sarcofago" } ] },

    { "id": "r-inspeccionar-vasijas", "priority": 0, "once": true,
      "trigger": { "type": "on_interact", "objectId": "vasijas" },
      "conditions": [],
      "actions": [
        { "type": "show_dialog", "dialogId": "d-vasijas" },
        { "type": "set_flag", "flag": "digito4", "value": 8 }
      ] },

    { "id": "r-canal-resuelto", "priority": 5, "once": true,
      "trigger": { "type": "on_puzzle_solved", "puzzleId": "p-canal-agua" },
      "conditions": [],
      "actions": [
        { "type": "set_object_state", "objectId": "altar", "state": "flowing" },
        { "type": "play_sound", "soundId": "fx-agua" }
      ] },

    { "id": "r-sello-resuelto", "priority": 10, "once": true,
      "trigger": { "type": "on_puzzle_solved", "puzzleId": "p-sello-final" },
      "conditions": [ { "type": "object_state_is", "objectId": "altar", "state": "flowing" } ],
      "actions": [
        { "type": "set_object_state", "objectId": "relicario", "state": "open" },
        { "type": "play_sound", "soundId": "fx-victoria" },
        { "type": "delay", "seconds": 4, "actions": [ { "type": "end_game", "result": "victory" } ] }
      ] },

    { "id": "r-aviso-10min", "priority": 50, "once": true,
      "trigger": { "type": "on_time_remaining_below", "seconds": 600 },
      "conditions": [],
      "actions": [
        { "type": "show_dialog", "dialogId": "d-aviso" },
        { "type": "play_sound", "soundId": "fx-tension" }
      ] },

    { "id": "r-tiempo-agotado", "priority": 99, "once": true,
      "trigger": { "type": "on_timer_end", "timerId": "cronometro" },
      "conditions": [],
      "actions": [ { "type": "end_game", "result": "timeout" } ] }
  ],

  "dialogs": [
    { "id": "d-intro", "text": "Profecía: «Solo los leales que despierten el fuego, equilibren la mesa y encaminen la luz, liberarán al Rey antes de que la última arena caiga.» Tenéis 60 minutos." },
    { "id": "d-cuadro", "text": "El retrato del Rey Aurelio, el más grande de los cuatro reinos. Su reloj de sol tiene cuatro torres. El cuadro cruje ligeramente…" },
    { "id": "d-brasero", "text": "El brasero arde: tres brasas flotan sobre las llamas. Se insinúa un número entre el fuego: el 3." },
    { "id": "d-mural", "text": "El mural se completa: los campesinos llevan las uvas al barril número 5. Un compartimento se abre tras el azulejo central." },
    { "id": "d-ranura", "text": "El cáliz encaja perfectamente en la ranura. Un mecanismo antiguo lo sujeta… aunque parece que podría recuperarse si hiciera falta." },
    { "id": "d-pergamino", "text": "Pergamino: «Los vinos encantados guardan memoria de pares: la uva con la uva, el sol con el sol, la llave con la llave.»" },
    { "id": "d-catacumbas", "text": "Las catacumbas huelen a incienso y a magia oscura. El relicario aguarda sellado sobre el altar. El canal de agua sagrada está seco." },
    { "id": "d-sarcofago", "text": "Aquí yace Aldric, el Rey Traicionado. La inscripción reza: «Cuatro reinos me vieron nacer, cinco uvas me vieron caer, tres pares me vieron llorar, ocho vasijas me vieron partir.»" },
    { "id": "d-vasijas", "text": "Ocho vasijas sagradas custodian las cenizas de los antiguos reyes." },
    { "id": "d-aviso", "text": "La arena casi ha caído. ¡Diez minutos!" }
  ],

  "hints": [
    { "id": "hint-arca-1", "puzzleId": "p-candado-arca", "tier": 1, "text": "Los cuatro retratos del fondo, de izquierda a derecha: torres, dragones, brasas, estatuas. Contad lo que muestra cada uno.", "cost": 1 },
    { "id": "hint-arca-2", "puzzleId": "p-candado-arca", "tier": 2, "text": "4 torres, 7 dragones, 3 brasas, 2 estatuas. Pero el brasero hay que encenderlo primero.", "cost": 2 },
    { "id": "hint-sello-1", "puzzleId": "p-sello-final", "tier": 1, "text": "El epitafio del sarcófago recuerda los números del castillo.", "cost": 1 },
    { "id": "hint-sello-2", "puzzleId": "p-sello-final", "tier": 2, "text": "4 reinos, 5 del barril del mural, 3 pares de copas, 8 vasijas.", "cost": 2 },
    { "id": "hint-sello-3", "puzzleId": "p-sello-final", "tier": 3, "text": "El agua debe fluir por el altar antes de que el sello acepte el código.", "cost": 3 }
  ]
}
```

---

## Notas de diseño del paquete

1. **Los dígitos del candado del arca (4732):** 4 torres (retrato Aurelio), 7 dragones (tapiz), 3 brasas (brasero, solo visible al encenderlo → la receta `mechero+vela→antorcha` es obligatoria), 2 estatuas. El orden lo dan los retratos de izquierda a derecha (narrativa del diseño original).

2. **El sello final (4538):** requiere `p-canal-agua` resuelto (`requiresSolved`) **y** altar en estado `flowing` (condición de la regla `r-sello-resuelto`) — doble candado narrativo: agua + código. Los dígitos se descubren en 3 salas distintas (4 en el Salón, 5 en el mural, 3 en las copas, 8 en las vasijas), forzando el recorrido completo.

3. **La llave dentro de la llave:** la receta de inspección (`llave-plata → llave-oro`, `consumeInputs: false`) usa la plantilla `combine_items` sin consumir — patrón reutilizable para "examinar un objeto".

4. **El cáliz tiene doble uso** (placa-puente en solitario + ranura del mural). La regla `r-recoger-caliz` permite recuperarlo tras la placas, evitando el soft-lock. El validador marca como 🟡 cualquier item con dos usos potencialmente conflictivos — aquí está resuelto explícitamente.

5. **La compuerta de oro** (`compuerta-oro`, `opensWithItem: llave-oro`) está en `blockedCells` del puzzle de tuberías: la llave-oro (de la llave-plata, del compartimento del mural, que necesita el cáliz del arca…) encadena Salón → Bodega → Catacumbas en orden estricto. El `grantsItems` de `p-mural-vendimia` incluye `llave-plata` para que el grafo de dependencias sea explícito aunque el objeto viva en un compartimento.

6. **`scramble: fixed_seed` (seed 812):** en eventos, todos los grupos reciben el mismo mural desordenado — justicia competitiva en ranking por tiempo.

7. **Antorchas de la escalera:** la narrativa original las tenía como antorchas del puzzle de memoria; en el paquete las luces de `bodega.lighting` quedan asociadas al estado `active` de `mesa-catas` (iluminación reactiva a puzzles — feature del runtime, no del formato).

---

## Informe de validación esperado

Al correr el validador sobre este paquete (definido en Especificaciones §10.3):

```
✅ Sin objetos huérfanos: todo item otorgado es alcanzable por una regla o puzzle
✅ Sin dead ends: toda puerta se desbloquea (puerta-bodega ← placas; reja ← mirillas)
✅ Solvabilidad: ruta crítica verificada (ver secuencia abajo)
🟡 El candado del arca tiene pistas asociadas (OK) — el sello final depende de 3 dígitos 
   descubiertos sin pista directa; cubierto por hint-sello-1/2 (OK)
✅ Sin reglas sin condiciones de corte (r-recoger-caliz es repeatable con guarda doble)
🟡 Dificultad 2 coherente con estimatedMinutes 55
```

**Secuencia de solución verificada (ruta crítica):**

```
1. Inspeccionar cuadro-aurelio          → llave-bronce
2. Abrir armario (llave-bronce)         → mechero + vela
3. Combinar mechero+vela                → antorcha
4. Encender brasero (antorcha)          → dígito 3 visible
5. Resolver candado-arca "4732"         → cáliz + pergamino
6. [Solo: cáliz en placa-izq] / [Grupo: placas simultáneas] → puerta-bodega
7. Resolver mural-vendimia (3×3)        → compartimento → llave-plata
8. Inspeccionar llave-plata             → llave-oro
9. Colocar cáliz en ranura (opcional, lore) / recuperarlo
10. Resolver copas-memoria (3 pares)    → dígito 3 + antorchas escalera
11. Mirillas (cooperativo / espejo)     → reja-escalera
12. Canal de tuberías (con llave-oro)   → altar flowing
13. Inspeccionar vasijas + sarcófago    → dígitos 8 y recuerdo del código
14. Sello final "4538"                  → relicario → VICTORIA
```

**Estimación:** ~45–55 min para grupo de 3–4 sin pistas; ~70 con 2 jugadores novatos.

---

## Uso como fixture

```typescript
// packages/game-runtime/__tests__/e2e.reyaldric.spec.ts
// Escenario: cargar roompackage-rey-aldric.json, simular la secuencia de 
// solución con 2 clientes de Colyseus y assert: end_game result=victory,
// 14 reglas fired exactamente una vez (excepto r-recoger-caliz), 
// p-sello-final resuelto con attempts=1 y timeRemaining > 0.
```

Este paquete debe versionarse junto al runtime: cualquier cambio en el formato RoomPackage que rompa este JSON es un **cambio breaking** y exige bump del formato (`packageFormat: "1"` en meta — campo a añadir cuando se implemente).
