const functions = require('firebase-functions');
const admin = require('firebase-admin');
const request = require('teeny-request').teenyRequest;


admin.initializeApp();
const firestoreDb = admin.firestore();
const firestoreAuth = admin.auth();

exports.updateFirestore = functions.database.ref('/funerals/{funeralId}')
    .onWrite((change, context) => {

        const funeral = context.params.funeralId;

        // // Grab the current value of what was written to the Realtime Database.
        const data = change.after.val();
        var finalImageURL = "";
       
        console.log('Processing new funeral:', data, funeral);

        var funeralObject = {
            firstName : data.firstName,
            lastName : data.lastName,
            funeralDate : admin.firestore.Timestamp.fromDate(new Date(data.funeralDate)),
            obituary : data.obituary,
            location : data.location,
            sid : data.sid,
            createdDate : admin.firestore.Timestamp.fromDate(new Date(data.createdDate)),
            isLive : data.isLive,
        };

        if (data.imageURL !== ""){
            finalImageURL = 'https:' + data.imageURL;
            funeralObject.imageURL = finalImageURL;
        }

        if (data.isDeleted !== "" && data.isDeleted !== null){
            funeralObject.isDeleted = data.isDeleted;
        }
        

        // if(!change.before.exists() || (change.before.val().imageURL !== change.after.val().imageURL)){

        //     // TODO - Go fetch new image and store it properly. For now using existing S3 storage
        //     funeralObject.imageURL = change.after.val().imageURL
    
        //     // return firestoreDb.collection('funerals').doc(context.params.funeralId).set({
        //     //     imageURL: change.after.val().imageURL
        //     // }, {merge: true});
    
        // }

        return firestoreDb.collection('funerals').doc('paperman-' + data.remote_id).set(funeralObject, {merge: true});

});

exports.newRemoteCondolence = functions.database.ref('/condolences/{condolenceId}')
    .onWrite(async (change, context) => {
        
        const data = change.after.val();
        const documentId = context.params.condolenceId;

        console.log("Creating condolence:", data);
        
        const checkUserDoc =  await checkUserInFirebase(data.email);

        if(data.isPublic)
        {
            if("remote_id" in data && !checkUserDoc.isError){  // it's remote and we have a valid user
                
                const checkCondolenceDoc = await checkIfCondolenceExists(checkUserDoc.user.uid, data.remote_funeral_id);

                if(checkCondolenceDoc)
                {
                    console.log('Duplicate condolence or comment');
                    return null; // condolence or comment already exists
                }
                
            }

            
            var condolenceObject = {
                name: data.name,
                email: data.email,
                message: data.message,
                updatedAt: admin.firestore.Timestamp.fromDate(new Date(data.updatedAt)),
                isPublic: data.isPublic,
                remoteId: data.remote_id,
            };

            var commentObject = {
                name: data.name,
                email: data.email,
                content: data.message,
                createdAt: admin.firestore.Timestamp.fromDate(new Date(data.updatedAt)),
                isPublic: data.isPublic,
                remoteId: data.remote_id
            };


            let batch = firestoreDb.batch();
            
            let condolenceRef = firestoreDb.collection('funerals').doc("paperman-" + data.remote_funeral_id)
            .collection('condolences').doc(documentId);
            batch.set(condolenceRef, condolenceObject);

            let commentRef = firestoreDb.collection('funerals').doc("paperman-" + data.remote_funeral_id)
            .collection('comments').doc(documentId);
            batch.set(commentRef, commentObject);

            if(functions.config().condolences.receive === "true"){
                return batch.commit();
            }
            else{
                return null;
            }
        }
        
});


async function checkIfCondolenceExists(uid, funeralId){
    let getCondolence = firestoreDb.collection('funerals').doc("paperman-" + funeralId)
    .collection('condolences').doc(uid).get();
    
    let getComment = firestoreDb.collection('funerals').doc("paperman-" + funeralId)
    .collection('comments').doc(uid).get();
    
    return Promise.all([getCondolence, getComment])
        .then(values => {
            const [condolence, comment] = values;
         
            if(condolence.exists || comment.exists ){
                return true;
            }
            else{
                return false;
            }
        })
        .catch((err) => {
            console.log('error', err);
            return false;
        });

}

async function checkUserInFirebase(email) {
    return new Promise((resolve) => {
        admin.auth().getUserByEmail(email)
            .then((user) => {
                resolve({ isError: false, doesExist: true, user });
                return null;
            })
            .catch((err) => {
                resolve({ isError: true, err });
            });
    });
}



async function createUserByEmail(email, name){

    return new Promise((resolve) => {
        admin.auth().createUser({
            email: email,
            emailVerified: false,
            // password: "secretPassword",
            displayName: name,
            // photoURL: "http://www.example.com/12345678/photo.png",
            disabled: false
        })
        .then((user) => {
            resolve({ isError: false, user });
            return null;
        })
        .catch((err) => {
            resolve({ isError: true, err });
        });
    });

}

exports.sendCondolence = functions.firestore
    .document('funerals/{funeralId}/condolences/{condolenceId}')
    .onWrite(async (change, context) => {

        const funeral = context.params.funeralId;
        const condolenceId = context.params.condolenceId;
        const data = change.after.exists ? change.after.data() : null;
        const funeralRef = firestoreDb.collection('funerals').doc(context.params.funeralId);
        
        const userEmail = await getUserEmailFromUID(condolenceId); 
        console.log("email:", userEmail, condolenceId);

        const settingsDoc = await checkSendSettings(condolenceId);

        sendRemoteCondolence(data, userEmail, funeralRef, condolenceId, settingsDoc.isDev);
    
});

exports.sendComment = functions.firestore
    .document('funerals/{funeralId}/comments/{commentId}')
    .onWrite(async (change, context) => {

        const funeral = context.params.funeralId;
        const commentId = context.params.commentId;
        const data = change.after.exists ? change.after.data() : null;
        const funeralRef = firestoreDb.collection('funerals').doc(context.params.funeralId);
        
        const userEmail = await getUserEmailFromUID(commentId); 

        const settingsDoc = await checkSendSettings(commentId);

        sendRemoteCondolence(data, userEmail, funeralRef, commentId, settingsDoc.isDev);
    
});


async function checkSendSettings(uid){

    return new Promise((resolve) => {
        firestoreDb.collection('settings').doc("1").get()
            .then((doc) => {
                if(doc.data().dontSend.includes(uid)){
                    resolve({ isDev: true });
                }
                else{
                    resolve({ isDev: false });
                }
                return null;
            })
            .catch((err) => {
                resolve({ isError: true, err });
            });
    });
    
}

function sendRemoteCondolence(data, userEmail, funeralRef, isDev){
    if(data === null){ //deleted
        return null;
    }
    else{
        if("remoteId" in data){ // Created on remote, dont send
            return null;
        }
        else{
            console.log('New local condolence');
            return funeralRef.get().then(doc => {
                if (!doc.exists) {
                    console.log('Funeral not found!');
                    return null;
                } else {
                    var payload = {
                        condolence: {
                            author: data.name,
                            email: userEmail,
                            message: data.content,
                        },
                        public: "true"
                    }
                    
                    
                    var options = {
                        uri: "http://b29a304873c9.ngrok.io/funerals/" + doc.data().sid + "/condolences",
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: payload
                    };

                    console.log('Sending', doc.data(), payload, firestoreAuth, firestoreAuth.currentUser);

                    if(functions.config().condolences.sendto === "Prod" && !isDev){
                        options.uri = "https://www.paperman.com/funerals/" + doc.data().sid + "/condolences";
                    }

                    return request(options, function (error, response, body) {
                        console.log('error:', error); // Print the error if one occurred 
                        console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received 
                        console.log('body:', body); //Prints the response of the request. 
                    });
                }
            });
        }
    }
}

async function getUserEmailFromUID(uid) {
    return new Promise((resolve) => {
        admin.auth().getUser(uid)
            .then((user) => {
                resolve(user.toJSON().email);
                return null;
            })
            .catch((err) => {
                resolve({ isError: true, err });
            });
    });
}
