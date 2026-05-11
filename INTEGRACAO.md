# Como integrar o chat nos dois arquivos

## 1. Copie os arquivos para o projeto

Coloque os dois arquivos dentro da pasta `js/` do projeto:

  js/chat-core.js
  js/chat-widget.js

---

## 2. index.html — usuário logado (almoxarifado)

Adicione no final do `app.js` (ou em um novo bloco após o login ser confirmado),
dentro do trecho onde você já tem o usuário autenticado:

```js
// No final de app.js, após confirmar login bem-sucedido:
import { mountChatWidget } from './chat-widget.js';
import { getFirestore } from 'firebase/firestore';

// Chame após o onAuthStateChanged confirmar usuário logado:
const db = getFirestore();
mountChatWidget({ modo: 'almox', db });
```

Se preferir, adicione uma tag script separada no final do index.html:

```html
<!-- Logo antes de </body> no index.html -->
<script type="module">
  import { mountChatWidget } from './js/chat-widget.js';
  import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.x.x/firebase-firestore.js';

  // Aguarda o app estar pronto (reutiliza a instância Firebase já inicializada)
  window.addEventListener('DOMContentLoaded', () => {
    const db = getFirestore();   // já inicializado pelo app.js
    mountChatWidget({ modo: 'almox', db });
  });
</script>
```

---

## 3. status.html — unidades (sem login obrigatório)

Adicione no final do bloco `<script type="module">` existente no status.html,
logo após o `init()` já existente:

```js
// Dentro do bloco <script type="module"> existente do status.html,
// logo após a chamada de init():

import { mountChatWidget } from './js/chat-widget.js';

// Após o onAuthStateChanged confirmar usuário (anônimo ou não):
onAuthStateChanged(auth, user => {
  if (user) {
    const { getFirestore } = await import('firebase/firestore');
    const db = getFirestore();
    mountChatWidget({ modo: 'unidade', db });
  }
});
```

---

## 4. Regras do Firestore

Abra o Firebase Console → Firestore → Regras e adicione o bloco do
arquivo `firestore-chat-rules.txt` junto com as regras existentes.

---

## 5. Por que isso é quase gratuito?

| Ação                      | Custo Firestore              |
|---------------------------|------------------------------|
| Abrir chat (onSnapshot)   | 1 leitura (o documento todo) |
| Cada nova mensagem chega  | 1 leitura por cliente ativo  |
| Enviar uma mensagem       | 1 leitura + 1 escrita        |
| Documento cheio (50 msgs) | Trim automático, sem crescer |

Estimativa real com 15 usuários e 80 mensagens/dia:
  Leituras:  ~1.200/dia  (limite gratuito: 50.000/dia)
  Escritas:  ~160/dia    (limite gratuito: 20.000/dia)
  Custo:     R$ 0,00     (100% dentro do plano gratuito)

---

## 6. Funcionalidades incluídas

- [x] Botão flutuante no canto inferior direito
- [x] Badge com contagem de mensagens não lidas
- [x] Identificação automática como "Almoxarifado da SEMCAS" no index.html
- [x] Formulário de nome + unidade no status.html (salvo em localStorage)
- [x] Filtro de palavrões em português
- [x] Limite de 300 caracteres por mensagem
- [x] Máximo de 50 mensagens no documento (trim automático)
- [x] Responsivo para mobile
- [x] Funciona com o signInAnonymously já usado no status.html
