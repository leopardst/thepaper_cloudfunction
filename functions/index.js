const functions = require('firebase-functions');
const admin = require('firebase-admin');
const request = require('teeny-request').teenyRequest;
const algoliasearch = require("algoliasearch");
// const algoliaModule = require('./algolia_import.js');

admin.initializeApp();
const firestoreDb = admin.firestore();
const firestoreAuth = admin.auth();

const ALGOLIA_ID = functions.config().algolia.app_id;
const ALGOLIA_ADMIN_KEY = functions.config().algolia.api_key;
const ALGOLIA_SEARCH_KEY = functions.config().algolia.search_key;

const ALGOLIA_INDEX_NAME = 'funerals';
const client = algoliasearch(ALGOLIA_ID, ALGOLIA_ADMIN_KEY);

exports.updateFuneralSearchIndex = functions.firestore.document('/funerals/{funeralId}')
    .onWrite((change, context) => {

        const index = client.initIndex(ALGOLIA_INDEX_NAME);

        if(change.after.exists){ // Not deleted, save to index
            const funeral = change.after.data();
            funeral.objectID = context.params.funeralId;
            funeral.createdDate = funeral.createdDate.toDate();
            funeral.funeralDate = (funeral.funeralDate === null) ? null : funeral.funeralDate.toDate();
            
            // Write to the algolia index
            return index.saveObject(funeral);
        }
        else{ // Deleted, so remove from index
            const funeral = change.before.data();
            funeral.objectID = context.params.funeralId;

            // Remove from the algolia index
            const index = client.initIndex(ALGOLIA_INDEX_NAME);
            return index.deleteObject(funeral);
        }
});

exports.updateFirestore = functions.database.ref('/funerals/{funeralId}')
    .onWrite((change, context) => {

        const funeral = context.params.funeralId;

        // // Grab the current value of what was written to the Realtime Database.
        const data = change.after.val();
        var finalImageURL = "";
        var _funeralDate;

        console.log('Processing new funeral:', data, funeral);

        console.log(data.funeralDate, (data.funeralDate !== null), (data.funeralDate !== 'null'));
        if(data.funeralDate === 'null' || data.funeralDate === null){
            _funeralDate = null;
        }else{
            _funeralDate = admin.firestore.Timestamp.fromDate(new Date(data.funeralDate));
        }

        var funeralObject = {
            firstName : data.firstName,
            lastName : data.lastName,
            funeralDate : _funeralDate,
            obituary : data.obituary,
            location : data.location,
            sid : data.sid,
            createdDate : admin.firestore.Timestamp.fromDate(new Date(data.createdDate)),
            isLive : data.isLive,
            lastTouchDate : admin.firestore.Timestamp.now(),
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

exports.newRemoteCondolence = functions.database.ref('/condolences/{funeralId}/{condolenceId}')
    .onWrite(async (change, context) => {
        
        const data = change.after.val();
        const documentId = context.params.funeralId + "-" + context.params.condolenceId;

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
                content: data.message.trim(),
                updatedAt: admin.firestore.Timestamp.fromDate(new Date(data.updatedAt)),
                isPublic: data.isPublic,
                remoteId: data.remote_id,
                isDeleted: false,
            };

            var commentObject = {
                name: data.name,
                email: data.email,
                content: data.message.trim(),
                createdAt: admin.firestore.Timestamp.fromDate(new Date(data.updatedAt)),
                isPublic: data.isPublic,
                remoteId: data.remote_id,
                isDeleted: false,
            };


            let batch = firestoreDb.batch();
            
            let condolenceRef = firestoreDb.collection('funerals').doc("paperman-" + data.remote_funeral_id)
            .collection('condolences').doc(documentId);
            batch.set(condolenceRef, condolenceObject, {merge: true});

            let commentRef = firestoreDb.collection('funerals').doc("paperman-" + data.remote_funeral_id)
            .collection('comments').doc(documentId);
            batch.set(commentRef, commentObject, {merge: true});

            if(functions.config().condolences.receive === "true"){
                console.log('Saving new condolence', condolenceRef, condolenceObject);
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

exports.condolenceHistoryAndDelete = functions.firestore
    .document('funerals/{funeralId}/condolences/{condolenceId}')
    .onWrite(async (change, context) => {

        const funeralId = context.params.funeralId;
        const condolenceId = context.params.condolenceId;
        
        const newValue = change.after.exists ? change.after.data() : null;
        const previousValue = change.before.data();
        
        const funeralRef = firestoreDb.collection('funerals').doc(context.params.funeralId);

        if(newValue.isDeleted){ // Deleted, save to history
            previousValue.isDeleted = true;
            previousValue.reason = 'deleted';
            previousValue.updatedAt = newValue.updatedAt.toDate();

            return firestoreDb.collection('funerals').doc(funeralId).collection('condolences').doc(condolenceId).collection('history').add(previousValue);
        } else if(newValue.content !== previousValue.content){
            previousValue.reason = 'content edited';
            previousValue.updatedAt = newValue.updatedAt;
            
            return firestoreDb.collection('funerals').doc(funeralId).collection('condolences').doc(condolenceId).collection('history').add(previousValue);
        }
});

exports.sendCondolence = functions.firestore
    .document('funerals/{funeralId}/condolences/{condolenceId}')
    .onWrite(async (change, context) => {

        const funeralId = context.params.funeralId;
        const condolenceId = context.params.condolenceId;
        const data = change.after.exists ? change.after.data() : null;
        const funeralRef = firestoreDb.collection('funerals').doc(context.params.funeralId);
        
        const userEmail = await getUserEmailFromUID(condolenceId); 
        console.log("email:", userEmail, condolenceId);

        const settingsDoc = await checkSendSettings(condolenceId);

        console.log('settings1', settingsDoc);

        sendRemoteCondolence(data, userEmail, funeralRef, settingsDoc);
        createUserCondolence(data, condolenceId, funeralRef, funeralId);
    
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

        sendRemoteCondolence(data, userEmail, funeralRef, settingsDoc);
    
});


async function checkSendSettings(uid){
    return new Promise((resolve) => {
        firestoreDb.collection('settings').doc('1').get()
            .then((doc) => {
                if(doc.data().blacklist.includes(uid)){
                    resolve({ blacklist: true, whitelist: false});
                }
                else{
                    if(doc.data().whitelist.includes(uid)){

                        resolve({ blacklist: false, whitelist: true });
                    }
                    else{
                        resolve({ blacklist: false, whitelist: false });
                    }
                }
                return null;
                
            })
            .catch((err) => {
                resolve({ isError: true, err });
            });
    });
    
}

function createUserCondolence(originalCondolence, uid, funeralRef, funeralId){
    // console.log('Starting: Adding condolence to users list of condolences', originalCondolence);
    if("remoteId" in originalCondolence){ // Created on remote, dont send
        return null;
    }
    else{    
        return funeralRef.get().then(doc => {
            if (!doc.exists) {
                console.log('Funeral not found!');
                return null;
            } else {
                
                var img;
                if(doc.data().imageURL){
                    img = doc.data().imageURL;
                }
                else{
                    img = null;
                }
                var userCondolenceObject = {
                    name: doc.data().firstName + ' ' + doc.data().lastName,
                    imageURL: img,
                    funeralDate: doc.data().funeralDate,
                    id: funeralId,
                };     

                console.log('Adding to users condolence list', uid, userCondolenceObject);

                if(!originalCondolence.isDeleted){
                    // new, add to list
                    // this is going to have to be changed if we stop using user UID as the ID for condolence
                    return firestoreDb.collection('users').doc(uid).update({
                        condolences: admin.firestore.FieldValue.arrayUnion(userCondolenceObject)
                    });
                }
                else{
                    // deleted, remove from list

                    return firestoreDb.collection('users').doc(uid).update({
                        condolences: admin.firestore.FieldValue.arrayRemove(userCondolenceObject)
                    });
                }
            }
        });
    }
}

function sendRemoteCondolence(data, userEmail, funeralRef, sendSettings){
    if(data === null){ //deleted
        return null;
    }
    else{
        if("remoteId" in data){ // Created on remote, dont send
            return null;
        }
        else{
            // console.log('New local condolence');
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

                    var whereTo = 'Dev';
                    
                    if(!sendSettings.blacklist){ //not blacklisted
                        
                        if(functions.config().condolences.sendto === "Prod" || sendSettings.whitelist){ // Prod or whitelisted
                            options.uri = "https://www.paperman.com/funerals/" + doc.data().sid + "/condolences";
                            whereTo = 'Prod'
                        }
                    }

                    console.log('Sending new local condolence', whereTo, doc.data(), payload, sendSettings);

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

// exports.scheduleDailyNotification = functions.pubsub.schedule('every 24 hours')
//     .timeZone('America/New_York').onRun((context) => {
//     console.log('Running!');
//     return null;
//   });


exports.newCondolence = functions.firestore
    .document('funerals/{funeralId}/condolences/{condolenceId}')
    .onCreate((snap, context) => {
    
        const newCondolence = snap.data();
        const condolenceId = context.params.condolenceId;
        const funeralId = context.params.funeralId;

        newCondolence.createdAt = newCondolence.updatedAt.toDate();

        return firestoreDb.collection('funerals').doc(funeralId).collection('condolences').doc(condolenceId).set(newCondolence, {merge: true});
    
});

 
exports.newUserProfile = functions.auth.user().onCreate((user) => {
    
    console.log('New user:', user);

    var userObject = {
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
        phoneNumber: user.phoneNumber,
        createdDate : admin.firestore.Timestamp.fromDate(new Date(user.metadata.creationTime)),
        providerData: {
            providerId: user.providerData[0].providerId,
            uid: user.providerData[0].uid,
        }
    };

    return firestoreDb.collection('users').doc(user.uid).set(userObject, {merge: true});

  });

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

exports.migrateCondolenceDelete = functions.https.onRequest(async (request, response) => {

    console.log('starting...');
    let condolencesRef = firestoreDb.collectionGroup('condolences');
    let allCondolences = await condolencesRef.get();

    allCondolences.forEach(doc=> {
        console.log('condolence:', doc);
        doc.ref
          .update({
            isDeleted: false
          })
      });
      return response.status(200).send('done');
  });

