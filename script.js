function createlogin() {
    let body = document.body;
    let FormConn = document.createElement("form");
    FormConn.id = "FormConn";
    let DivTitle = document.createElement("div");
    DivTitle.id = "Title";
    let Title = document.createElement("h1");
    Title.id = "IntraTitle";
    Title.innerText = "Intra GraphQl"
    let Users = document.createElement("input");
    Users.id = "AreaUser";
    Users.type = "texte";
    Users.required = true;
    let TextUser = document.createElement("label");
    TextUser.htmlFor = "AreaUser";
    TextUser.innerText = "Email ou Nom d'utilisateur";
    let Mdp = document.createElement("input");
    Mdp.id = "AreaMdp";
    Mdp.type = "password";
    Mdp.required = true;
    let TextMdp = document.createElement("p");
    TextMdp.htmlFor = "AreaMdp";
    TextMdp.innerText = "Mot de passe";
    let Submit = document.createElement("input");
    Submit.id = "Send";
    Submit.type = "button";
    Submit.value = "Se Connecter"
    FormConn.appendChild(TextUser);
    FormConn.appendChild(Users);
    FormConn.appendChild(TextMdp);
    FormConn.appendChild(Mdp);
    FormConn.appendChild(Submit);
    body.appendChild(FormConn);
    Submit.addEventListener("click", async function () {
      event.preventDefault();
      const Username = Users.value;
      const UserMdp = Mdp.value;
      const info = btoa(`${Username}:${UserMdp}`);
      try {
        const raiponce = await fetch("https://zone01normandie.org/api/auth/signin", {
          method: "POST",
          headers: {
            Authorization: `Basic ${info}`,
          },
        });
        if (raiponce.ok) {
          const data = await raiponce.json();
          localStorage.setItem("jwt", data.token);
          DrawIntra(data);
        } // mettre un else si l'on veux cree une div pour afficher l'erreur
      } catch (error) {
        alert("coucou");
      }
    });
  }
  
  function DrawIntra(data) {
    document.body.innerHTML = "";
    const query = {
      query: `{
          user{
              id
              lastName
              firstName
              auditRatio
              totalUp
              totalDown
          }
              transaction{
                  amount
                  type
              }
          }`,
    };
    const query2 = {
      query: `{
           user {
                xps {
                     amount
                }
           }
      }`,
    };
    const query3 = {
      query: `{
           user {
                transactions(order_by: {createdAt: asc}){
                     type
                     amount
                }
           }
      }`,
    };
    fetch("https://zone01normandie.org/api/graphql-engine/v1/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${data}`,
      },
      body: JSON.stringify(query),
    })
      .then((response) => response.json())
      .then((data) => {
        const data2 = data.data.user[0];
        let delog = document.createElement("input");
        delog.id = "delog";
        delog.type = "button";
        delog.value = "Se Deconnecter";
        delog.addEventListener("click", function () {
          location.reload();
        });
        document.body.appendChild(delog);
        
        let Divpseud = document.createElement("div");
        Divpseud.id = "Name";
        let Name = document.createElement("h1");
        Name.id = "IntraName";
        Name.innerText = "Bienvenue " + data2.firstName + " " + data2.lastName;
        
        let auditratin = document.createElement("div");
        auditratin.id = "ration";
        let ratiotexte = document.createElement("p");
        ratiotexte.id = "Textraction";
        ratiotexte.innerText = "Audits ratio";
        
        let total = document.createElement("h4");
        total.id = "total";
        total.innerText = Math.round(data2.auditRatio * 10) / 10;
        
        const maxBarHeight = 100; 
        const barWidth = 50;
        const barSpacing = 65; 
        
        // Créer un conteneur SVG pour le bar chart
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("width", (barWidth * 2) + barSpacing + 50); 
        svg.setAttribute("height", maxBarHeight + 50); 
        
        // Créer la barre pour totalUp
        const upBarHeight = (data2.totalUp / Math.max(data2.totalUp, data2.totalDown)) * maxBarHeight;
        const upRect = document.createElementNS(svgNS, "rect");
        upRect.setAttribute("x", "7"); 
        upRect.setAttribute("y", maxBarHeight - upBarHeight + 5);
        upRect.setAttribute("width", barWidth); 
        upRect.setAttribute("height", upBarHeight); 
        upRect.setAttribute("fill", "green"); 
        svg.appendChild(upRect);
        
        // Ajouter un texte au-dessus de la barre up
        const upText = document.createElementNS(svgNS, "text");
        upText.setAttribute("x", "7");
        upText.setAttribute("y", maxBarHeight - upBarHeight + 5); 
        upText.setAttribute("font-family", "Arial");
        upText.setAttribute("font-size", "12");
        upText.setAttribute("fill", "#ffffff");
        upText.textContent = `Received: ${(data2.totalUp * 10e-7).toFixed(2)} MB`;
        svg.appendChild(upText);
        
        // Créer la barre pour totalDown
        const downBarHeight = (data2.totalDown / Math.max(data2.totalUp, data2.totalDown)) * maxBarHeight;
        const downRect = document.createElementNS(svgNS, "rect");
        downRect.setAttribute("x", barWidth + barSpacing + 10);
        downRect.setAttribute("y", maxBarHeight - downBarHeight + 10); 
        downRect.setAttribute("width", barWidth); 
        downRect.setAttribute("height", downBarHeight);
        downRect.setAttribute("fill", "red"); 
        svg.appendChild(downRect);
        
        // Ajouter un texte au-dessus de la barre down
        const downText = document.createElementNS(svgNS, "text");
        downText.setAttribute("x", barWidth + barSpacing + 10);
        downText.setAttribute("y", maxBarHeight - downBarHeight + 5); // Position pour le texte
        downText.setAttribute("font-family", "Arial");
        downText.setAttribute("font-size", "8");
        downText.setAttribute("fill", "#ffffff");
        downText.textContent = `Done: ${(data2.totalDown * 10e-7).toFixed(2)} MB`;
        svg.appendChild(downText);
        
        Divpseud.appendChild(Name);
        auditratin.appendChild(ratiotexte);
        auditratin.appendChild(svg);
        auditratin.appendChild(total);
        document.body.appendChild(Divpseud);
        document.body.appendChild(auditratin);
        
        const alltransaction = data.data.transaction;
        var allskills = [];
        for (let i = 0; i < alltransaction.length; i++) {
          if (alltransaction[i].type.includes("skill_")) {

            allskills.push(alltransaction[i]);
          }
        }
        let tabEach = [[]];
        allskills.forEach((element) => {
          let found = false; // Indicateur pour savoir si on a trouvé un tableau avec le même type
          // Vérifier chaque sous-tableau de tabEach
          tabEach.forEach((skill) => {
            // Si le type du premier élément du sous-tableau correspond au type de l'élément courant
            if (tabEach[0].length === 0) {
              tabEach[0].push(element);
              found = true;
            } else if (skill[0].type === element.type) {
              skill.push(element);
              found = true; 
              return; 
            }
          });
          // Si aucun tableau avec le même type n'a été trouvé
          if (!found) {
            let newTab = []; 
            newTab.push(element); 
            tabEach.push(newTab); 
          }
        });
        let tabMax = [];
        for (let i = 0; i < tabEach.length; i++) {
          let max = getMaxValue(tabEach[i]);
          tabMax.push(max);
        }
        const ringsContainer = document.createElement("div");
        ringsContainer.id = "ringsContainer";
        tabMax.forEach((element) => {
          const svgRing = createCircularRingSVG(element.amount, element.type);
          const div = document.createElement("div");
          div.innerHTML = svgRing;
          ringsContainer.appendChild(div);
        });
        document.body.appendChild(ringsContainer);
      });
  }
  function getMaxValue(arr) {
    // Utiliser reduce pour trouver l'objet avec la valeur 'amount' maximale
    return arr.reduce((max, obj) => {
      return obj.amount > max.amount ? obj : max;
    });
  }
  function createCircularRingSVG(percentage, type, radius = 105, strokeWidth = 10) {
    // Limite le pourcentage entre 0 et 100
    percentage = Math.min(100, Math.max(0, percentage));
    // Dimensions du cercle
    const diameter = radius * 2;
    const circumference = 2 * Math.PI * (radius - strokeWidth / 2);
    // Calcul de l'offset pour représenter le pourcentage
    const offset = circumference - (percentage / 100) * circumference;
// Création du SVG avec les éléments cercle
const svg = `
    <svg width="${diameter}" height="${diameter}" viewBox="0 0 ${diameter} ${diameter}">
        <!-- Cercle de fond -->
        <circle
            cx="${radius}" cy="${radius}" r="${radius - strokeWidth / 2}"
            fill="none"
            stroke="#e6e6e6"
            stroke-width="${strokeWidth}"
        />
        
        <!-- Cercle de progression -->
        <circle
            cx="${radius}" cy="${radius}" r="${radius - strokeWidth / 2}"
            fill="none"
            stroke="#dc3545"
            stroke-width="${strokeWidth}"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${offset}"
            stroke-linecap="round"
            transform="rotate(-90 ${radius} ${radius})"
        />
        
        <!-- Texte au centre -->
        <text
            x="50%" y="50%" text-anchor="middle" dy=".3em"
            font-size="20px" fill="white">
            ${type} ${percentage}%
        </text>
    </svg>
`;

    return svg;
  }
  createlogin();