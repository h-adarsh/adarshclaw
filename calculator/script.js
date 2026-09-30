document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('todo-input');
    const addBtn = document.getElementById('add-btn');
    const todoList = document.getElementById('todo-list');

    // Load todos from localStorage if available
    let todos = JSON.parse(localStorage.getItem('todos') || '[]');

    function renderTodos() {
        todoList.innerHTML = '';
        todos.forEach((todo, index) => {
            const li = document.createElement('li');
            li.className = 'todo-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = todo.completed;
            checkbox.addEventListener('change', () => toggleTodo(index));
            
            const span = document.createElement('span');
            span.className = `todo-text ${todo.completed ? 'completed' : ''}`;
            span.textContent = todo.text;
            
            const btnDelete = document.createElement('button');
            btnDelete.className = 'btn-delete';
            btnDelete.textContent = '✕';
            btnDelete.addEventListener('click', () => deleteTodo(index));
            
            const btnComplete = document.createElement('button');
            btnComplete.className = 'btn-complete';
            btnComplete.textContent = todo.completed ? '✓' : '✓';
            btnComplete.addEventListener('click', () => toggleTodo(index));
            
            li.appendChild(checkbox);
            li.appendChild(span);
            li.appendChild(btnDelete);
            li.appendChild(btnComplete);
            todoList.appendChild(li);
        });
    }

    function addTodo() {
        const text = input.value.trim();
        if (text) {
            todos.push({ text, completed: false });
            saveTodos();
            renderTodos();
            input.value = '';
            input.focus();
        }
    }

    function toggleTodo(index) {
        todos[index].completed = !todos[index].completed;
        saveTodos();
        renderTodos();
    }

    function deleteTodo(index) {
        todos.splice(index, 1);
        saveTodos();
        renderTodos();
    }

    function saveTodos() {
        localStorage.setItem('todos', JSON.stringify(todos));
    }

    // Event listeners
    addBtn.addEventListener('click', addTodo);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addTodo();
    });

    renderTodos();
});
