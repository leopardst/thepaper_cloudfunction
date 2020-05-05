const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const firestoreDb = admin.firestore();
const firestoreAuth = admin.auth();

exports.updateFirestore = functions.database.ref('/funerals/{funeralId}')
    .onWrite((change, context) => {

        const funeral = context.params.funeralId;
        // const radio = context.params.radioId;

        // // Grab the current value of what was written to the Realtime Database.
        const data = change.after.val();
        var finalImageURL = "";
        // const formattedFuneralDate = admin.firestore.Timestamp.fromMillis(data.funeralDate.Timestamp.);
        // console.log('date:', data.fields.funeral.funeralDate);
        console.log('Processing new funeral:', data, funeral);



        var funeralObject = {
            firstName : data.firstName,
            lastName : data.lastName,
            funeralDate : admin.firestore.Timestamp.fromDate(new Date(data.funeralDate)),
            obituary : data.obituary,
            location : data.location,
            sid : data.sid,
            createdDate : data.createdDate,
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

        return firestoreDb.collection('funerals').doc('paperman-' + data.papermanFuneralId).set(funeralObject, {merge: true});

});

exports.newRemoteCondolence = functions.database.ref('/funerals/{funeralId}/condolences')
    .onWrite(async (change, context) => {
        
        const funeralId = context.params.funeralId;
        const data = change.after.val();
        var user;

        console.log("Processing new condolence:" + data);

        // Check if user exists
        const snapshot = await checkUserInFirebase(data.email);
        console.log("snapshot:" + snapshot);
        if (snapshot.isError){
            console.log("Creating new user");
            const newSnapshot = await createUserByEmail(data.email, data.name);
            user = newSnapshot.user;
        }
        else{
            user = snapshot.user;
        }

        console.log("Creating condolence:", condolenceObject, user.email);

        if(user){
            var condolenceObject = {
                name: data.name,
                email: data.email,
                message: data.message,
                updatedAt: data.updatedAt,
                isPublic: data.isPublic,
                remote_id: data.remote_id,
            };

            return firestoreDb.collection('funerals').doc(funeralId)
                .collection('condolences').doc(user.uid).set(condolenceObject);
        }
        else{
            console.log("Something went wrong")
            return null;
        }
        
});

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
    // try{
    //     const snapshot = await firestoreAuth.getUserByEmail(email);
    //     return snapshot
    // }
    // catch{
    //     console.log('error');        
    //     if (error.code === 'auth/user-not-found') {
    //         return createUserByEmail(email, name);
    //      }
    // }
    


async function createUserByEmail(email, name){
    // console.log("create user");

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

    // try{

    //     const user = await admin.auth().createUser({
    //         email: email,
    //         emailVerified: false,
    //         // password: "secretPassword",
    //         displayName: name,
    //         // photoURL: "http://www.example.com/12345678/photo.png",
    //         disabled: false
    //     });
        
    //     return user;
    // }
    // catch (error){
    //     console.log('Error creating user', email);
    // }

    // admin.auth().createUser({
    //     email: email,
    //     emailVerified: false,
    //     // password: "secretPassword",
    //     displayName: name,
    //     // photoURL: "http://www.example.com/12345678/photo.png",
    //     disabled: false
    // })
    // .then((userRecord) => {
    //     // See the UserRecord reference doc for the contents of userRecord.
    //     // console.log("Successfully created new user:", userRecord.uid);
    //     return userRecord;
    // })
    // .catch((error) => {
    //     // console.log("Error creating new user:", error);
    //     return null;
    // }); 
}

exports.sendCondolence = functions.firestore
    .document('funerals/{funeralId}/condolences/{condolenceId}')
    .onCreate((snap, context) => {

        const newValue = snap.data();
        const funeralDoc = firestoreDb.collection('funerals').doc(context.params.funeralId);
        const getDoc = funeralDoc.get()
            .then(doc => {
                
                    console.log('New condolence:', newValue, doc.data());
                return "";
                })
                .catch(err => {
                console.log('Error getting document', err);
                });
            
        return "";

        // request.post('http://2f14e740.ngrok.io/$', function (error, response, body) {
        //     console.log('error:', error); // Print the error if one occurred 
        //     console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received 
        //     console.log('body:', body); //Prints the response of the request. 
        //   });
});

